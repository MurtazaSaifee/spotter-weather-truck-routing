import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from './api/plan';
import { chicago, dallas } from './test/fixtures/places';
import {
  chicagoToDallas,
  chicagoToDallasAllBlocked,
  chicagoToDallasStormOnRouteOne,
  routeOne,
  routeTwo,
} from './test/fixtures/plan';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

// 10:20 in Los Angeles, the browser's zone in tests.
const NOW = new Date('2026-10-14T17:20:00Z');

async function planTrip(user: UserEvent, plan: Plan) {
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', () => HttpResponse.json(plan)),
  );
  const choose = async (field: string, text: string, label: string) => {
    await user.type(screen.getByRole('combobox', { name: field }), text);
    await user.click(await screen.findByRole('option', { name: label }));
  };
  await choose('Origin', 'Chicago', chicago.label);
  await choose('Destination', 'Dallas', dallas.label);
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
  await screen.findByRole('heading', { name: 'Routes' });
}

const card = (label: string) => screen.getByText(label).closest('button')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the recommendation', () => {
  it('selects the recommended route on the map', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasStormOnRouteOne);

    const map = screen.getByRole('region', { name: 'Map' });
    expect(within(map).getByRole('button', { name: 'Route 1 on map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(map).getByRole('button', { name: 'Route 2 on map' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('hands the map the recommended route and which routes are blocked', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasStormOnRouteOne);

    const onMap = (n: number) => screen.getByRole('button', { name: `Route ${n} on map` });
    expect(onMap(1)).toHaveAttribute('data-recommended', 'true');
    expect(onMap(2)).toHaveAttribute('data-recommended', 'false');
    expect(onMap(3)).toHaveAttribute('data-blocked', 'true');
    expect(onMap(1)).toHaveAttribute('data-blocked', 'false');
  });

  it('hands the map no recommended route when every route is blocked', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasAllBlocked);

    for (const n of [1, 2, 3]) {
      expect(screen.getByRole('button', { name: `Route ${n} on map` })).toHaveAttribute(
        'data-recommended',
        'false',
      );
    }
  });

  it('lists the cards best first, with a Recommended mark and a Blocked mark', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasStormOnRouteOne);

    const cards = within(screen.getByRole('region', { name: 'Routes' })).getAllByRole('button');
    // Numbered by rank, so the cards read in order whichever route the plan lists first.
    expect(cards.map((c) => c.textContent?.match(/^Route \d/)?.[0])).toEqual([
      'Route 1',
      'Route 2',
      'Route 3',
    ]);
    expect(card('Route 1')).toHaveTextContent('Recommended');
    expect(card('Route 2')).not.toHaveTextContent('Recommended');
    expect(card('Route 3')).toHaveTextContent('Blocked by No Travel');
  });

  it("shows each route's risk mileage, unassessed miles and average risk on its card", async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasStormOnRouteOne);

    const stormy = card('Route 2');
    expect(stormy).toHaveTextContent('Severe 50 mi');
    expect(stormy).toHaveTextContent('High 50 mi');
    expect(stormy).toHaveTextContent('No Travel 0 mi');
    expect(stormy).toHaveTextContent('Unassessed 26.8 mi');
    expect(stormy).toHaveTextContent('Average risk 1.20');
    const blocked = card('Route 3');
    expect(blocked).toHaveTextContent('No Travel 29.4 mi');
    expect(blocked).toHaveTextContent('Unassessed 0 mi');
  });

  it('says so on the card when a route has no average risk', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, {
      ...chicagoToDallas,
      routes: [{ ...routeOne, average_risk: null }, routeTwo],
    });

    expect(card('Route 1')).toHaveTextContent('Average risk n/a');
  });
});

describe('when every route is blocked', () => {
  it('warns not to travel and recommends nothing', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasAllBlocked);

    expect(screen.getByRole('alert')).toHaveTextContent('Do not travel at this departure time');
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
  });

  it('still shows every route, marked blocked', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasAllBlocked);

    for (const label of ['Route 1', 'Route 2', 'Route 3']) {
      expect(card(label)).toHaveTextContent('Blocked by No Travel');
    }
  });

  it('selects the best-ranked route on the map', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallasAllBlocked);

    expect(screen.getByRole('button', { name: 'Route 1 on map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows no warning when a route can be recommended', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, chicagoToDallas);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('No data', () => {
  it('shows the plan notice about checkpoints without a forecast', async () => {
    const user = userEvent.setup();
    renderApp();

    await planTrip(user, {
      ...chicagoToDallas,
      notices: [
        {
          code: 'no_data_checkpoints',
          message: 'The forecast is missing at 2 checkpoints.',
        },
      ],
    });

    expect(screen.getByText('The forecast is missing at 2 checkpoints.')).toBeInTheDocument();
  });
});
