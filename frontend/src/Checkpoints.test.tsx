import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanRequest } from './api/plan';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas, chicagoToDallasEveryTenMiles } from './test/fixtures/plan';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

// 10:20 in Los Angeles, the browser's zone in tests; the default departure is 11:00 AM.
const NOW = new Date('2026-10-14T17:20:00Z');

/** Answers suggestions, and plans with the 10 mi plan when asked for 10 mi, else the 25 mi one. */
function answerPlans(gate?: Promise<void>) {
  const requests: PlanRequest[] = [];
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', async ({ request }) => {
      const body = (await request.json()) as PlanRequest;
      requests.push(body);
      if (gate && requests.length > 1) await gate;
      return HttpResponse.json(
        body.interval_miles === 10 ? chicagoToDallasEveryTenMiles : chicagoToDallas,
      );
    }),
  );
  return requests;
}

async function planTrip(user: UserEvent) {
  const choose = async (field: string, text: string, label: string) => {
    await user.type(screen.getByRole('combobox', { name: field }), text);
    await user.click(await screen.findByRole('option', { name: label }));
  };
  await choose('Origin', 'Chicago', chicago.label);
  await choose('Destination', 'Dallas', dallas.label);
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
  await screen.findByText('Route 1');
}

const intervalGroup = () => screen.getByRole('group', { name: 'Checkpoint interval' });
const interval = (miles: number) => within(intervalGroup()).getByRole('button', { name: `${miles} mi` });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkpoint interval', () => {
  it('shows the interval the server chose and says it was chosen automatically', async () => {
    answerPlans();
    const user = userEvent.setup();
    renderApp();

    await planTrip(user);

    expect(interval(25)).toHaveAttribute('aria-pressed', 'true');
    expect(interval(10)).toHaveAttribute('aria-pressed', 'false');
    expect(interval(50)).toHaveAttribute('aria-pressed', 'false');
    expect(within(intervalGroup().parentElement!).getByText('Auto')).toBeInTheDocument();
  });

  it('plans the same trip again with the override, and the label stops saying Auto', async () => {
    const requests = answerPlans();
    const user = userEvent.setup();
    renderApp();
    await planTrip(user);

    await user.click(interval(10));

    await vi.waitFor(() => expect(interval(10)).toHaveAttribute('aria-pressed', 'true'));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ ...requests[0], interval_miles: 10 });
    expect(requests[0]).not.toHaveProperty('interval_miles');
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();
  });

  it('keeps the routes and the selection on screen while it plans again', async () => {
    let release!: () => void;
    answerPlans(new Promise<void>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderApp();
    await planTrip(user);
    await user.click(screen.getByText('Route 2'));

    await user.click(interval(50));

    expect(screen.getByText('Route 3')).toBeInTheDocument();
    expect(screen.queryByText('Finding routes…')).not.toBeInTheDocument();
    expect(screen.getByText('Route 2').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(interval(10)).toBeDisabled();
    release();
    await vi.waitFor(() => expect(interval(10)).toBeEnabled());
    expect(screen.getByText('Route 2').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not plan again when the interval already in use is pressed', async () => {
    const requests = answerPlans();
    const user = userEvent.setup();
    renderApp();
    await planTrip(user);

    await user.click(interval(25));

    expect(requests).toHaveLength(1);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });
});

describe('checkpoints on the map', () => {
  it('gives the map every route\'s checkpoints', async () => {
    answerPlans();
    const user = userEvent.setup();
    renderApp();

    await planTrip(user);

    const map = screen.getByRole('region', { name: 'Map' });
    for (const route of [1, 2, 3]) {
      expect(within(map).getAllByRole('button', { name: new RegExp(`^Route ${route} checkpoint at mile`) })).toHaveLength(3);
    }
  });

  it('shows a checkpoint\'s mile, ETA in the origin zone and covered miles', async () => {
    answerPlans();
    const user = userEvent.setup();
    renderApp();
    await planTrip(user);

    await user.click(screen.getByRole('button', { name: 'Route 1 checkpoint at mile 25' }));

    const details = screen.getByRole('tooltip');
    expect(details).toHaveTextContent('Route 1');
    expect(details).toHaveTextContent('Mile 25');
    // 08:31 CDT, though the browser is on Pacific time.
    expect(details).toHaveTextContent('Thu Oct 15, 8:31 AM CDT');
    expect(details).toHaveTextContent('Covers 25 mi');
  });

  it('says the first checkpoint covers only its inner half-gap', async () => {
    answerPlans();
    const user = userEvent.setup();
    renderApp();
    await planTrip(user);

    await user.click(screen.getByRole('button', { name: 'Route 1 checkpoint at mile 0' }));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Covers 12.5 mi');
  });
});
