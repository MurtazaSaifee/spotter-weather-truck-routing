import { act, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas } from './test/fixtures/plan';
import { heatmapOfChicagoToDallas } from './test/fixtures/heatmap';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const NOW = new Date('2026-10-14T17:20:00Z');

const weatherBusy = (seconds: number) =>
  HttpResponse.json(
    {
      code: 'weather_rate_limited',
      message: 'The weather service is busy. Please try again in a moment.',
      details: { retry_after_seconds: seconds },
    },
    { status: 429 },
  );

const visitorLimited = (seconds: number) =>
  HttpResponse.json(
    {
      code: 'rate_limit_exceeded',
      message: "You've made a lot of requests. Please wait a little before trying again.",
      details: { retry_after_seconds: seconds },
    },
    { status: 429 },
  );

/** Answers each plan and heatmap request with the next of its responses (the last repeats),
 * and counts how many of each arrived. */
function answerWith(responses: {
  plan?: Array<() => Response | Promise<Response>>;
  heatmap?: Array<() => Response | Promise<Response>>;
}) {
  const calls = { plan: 0, heatmap: 0 };
  const next = (list: Array<() => Response | Promise<Response>>, count: number) =>
    list[Math.min(count, list.length - 1)]();
  const planOk = () => HttpResponse.json(chicagoToDallas);
  const heatmapOk = () => HttpResponse.json(heatmapOfChicagoToDallas);
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', () => next(responses.plan ?? [planOk], calls.plan++)),
    http.post('/api/heatmap', () => next(responses.heatmap ?? [heatmapOk], calls.heatmap++)),
  );
  return calls;
}

async function planChicagoToDallas(user: UserEvent) {
  await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');
  await user.click(await screen.findByRole('option', { name: chicago.label }));
  await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Dallas');
  await user.click(await screen.findByRole('option', { name: dallas.label }));
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
}

const tick = (seconds: number) => act(() => vi.advanceTimersByTimeAsync(seconds * 1000));

beforeEach(() => {
  // Time moves on its own (so MSW and Testing Library still settle) and the tests move it
  // further by hand.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function startUser() {
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

describe('a rate-limited plan', () => {
  it.each([
    ['weather_rate_limited', weatherBusy, 'The weather service is busy.'],
    ['rate_limit_exceeded', visitorLimited, "You've made a lot of requests."],
  ])('counts down after %s and retries once by itself', async (_code, limited, message) => {
    const calls = answerWith({
      plan: [() => limited(3), () => HttpResponse.json(chicagoToDallas)],
    });
    const user = startUser();
    renderApp();

    await planChicagoToDallas(user);

    const countdown = (seconds: number) =>
      screen.getByText(new RegExp(`${message} .*Trying again in ${seconds} s`));
    await screen.findByText(/Trying again in 3 s/);
    expect(countdown(3)).toBeInTheDocument();
    await tick(1);
    expect(countdown(2)).toBeInTheDocument();
    await tick(1);
    expect(countdown(1)).toBeInTheDocument();
    expect(calls.plan).toBe(1);

    await tick(1);

    expect(await screen.findByText('Route 3')).toBeInTheDocument();
    expect(calls.plan).toBe(2);
    expect(screen.queryByText(/Trying again/)).not.toBeInTheDocument();
  });

  it('tries again only once, then shows the message and leaves the next attempt to the driver', async () => {
    const calls = answerWith({ plan: [() => weatherBusy(2)] });
    const user = startUser();
    renderApp();
    await planChicagoToDallas(user);
    await screen.findByText(/Trying again in 2 s/);

    await tick(2);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The weather service is busy. Please try again in a moment.',
    );
    await tick(60);
    expect(calls.plan).toBe(2);
    expect(screen.queryByText(/Trying again/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan trip' })).toBeEnabled();
  });
});

describe('a visitor limit that lasts most of an hour', () => {
  it('shows the message without a countdown and does not retry', async () => {
    const calls = answerWith({ plan: [() => visitorLimited(40 * 60)] });
    const user = startUser();
    renderApp();

    await planChicagoToDallas(user);

    expect(await screen.findByRole('alert')).toHaveTextContent("You've made a lot of requests.");
    expect(screen.queryByText(/Trying again/)).not.toBeInTheDocument();
    await tick(120);
    expect(calls.plan).toBe(1);
  });
});

describe('a rate-limited heatmap', () => {
  it('leaves the routes in place, counts down and retries once by itself', async () => {
    const calls = answerWith({
      heatmap: [() => weatherBusy(2), () => HttpResponse.json(heatmapOfChicagoToDallas)],
    });
    const user = startUser();
    renderApp();

    await planChicagoToDallas(user);

    await screen.findByText(/Trying again in 2 s/);
    expect(screen.getByText('Route 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Route 1 on map' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    await tick(2);

    expect(await screen.findByRole('slider', { name: 'Hours after departure' })).toBeInTheDocument();
    expect(calls.heatmap).toBe(2);
    expect(screen.getByText('Route 1')).toBeInTheDocument();
  });

  it('gives up after the one retry, keeps the routes and offers a manual retry', async () => {
    const calls = answerWith({
      heatmap: [() => visitorLimited(2), () => visitorLimited(2), () => HttpResponse.json(heatmapOfChicagoToDallas)],
    });
    const user = startUser();
    renderApp();
    await planChicagoToDallas(user);
    await screen.findByText(/Trying again in 2 s/);

    await tick(2);

    expect(await screen.findByText('The forecast heatmap could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Route 3')).toBeInTheDocument();
    await tick(60);
    expect(calls.heatmap).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('slider', { name: 'Hours after departure' })).toBeInTheDocument();
  });
});

describe('a slow first response', () => {
  it('says the server is waking up after 3 seconds without a response, until it answers', async () => {
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    answerWith({
      plan: [
        async () => {
          await answered;
          return HttpResponse.json(chicagoToDallas);
        },
      ],
    });
    const user = startUser();
    renderApp();

    await planChicagoToDallas(user);

    expect(await screen.findByText('Finding routes…')).toBeInTheDocument();
    expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument();
    await tick(2);
    expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument();
    await tick(1);
    expect(screen.getByText(/waking up the server/i)).toBeInTheDocument();

    answer();

    expect(await screen.findByText('Route 3')).toBeInTheDocument();
    expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument();
  });
});
