import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanRequest } from './api/plan';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas, routeOne, routeThree, routeTwo } from './test/fixtures/plan';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const PLAN_PATH = '/api/plan';

// 10:20 in Los Angeles, which is the browser's zone in tests (see globalSetup).
// The next full hour, 11:00 AM, is the default departure.
const NOW = new Date('2026-10-14T17:20:00Z');

/** Answers suggestions with Chicago and Dallas, and every plan request with `plan`. */
function answerPlansWith(response: () => Response | Promise<Response>) {
  const requests: PlanRequest[] = [];
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post(PLAN_PATH, async ({ request }) => {
      requests.push((await request.json()) as PlanRequest);
      return response();
    }),
  );
  return requests;
}

const planOk = () => HttpResponse.json(chicagoToDallas);

async function choosePlace(
  user: UserEvent,
  field: 'Origin' | 'Destination',
  text: string,
  label: string,
) {
  await user.type(screen.getByRole('combobox', { name: field }), text);
  await user.click(await screen.findByRole('option', { name: label }));
}

const chooseOrigin = (user: UserEvent) => choosePlace(user, 'Origin', 'Chicago', chicago.label);
const chooseDestination = (user: UserEvent) =>
  choosePlace(user, 'Destination', 'Dallas', dallas.label);

const weightField = () => screen.getByRole('textbox', { name: 'Load weight' });
const planButton = () => screen.getByRole('button', { name: 'Plan trip' });

/** Types a departure into the picker's date and time sections: `10/16/2026 09:00 AM`. */
async function typeDeparture(user: UserEvent, keys: string) {
  const picker = screen.getByRole('group', { name: 'Departure' });
  await user.click(within(picker).getByRole('spinbutton', { name: 'Month' }));
  await user.keyboard(keys);
}

function departureText() {
  const picker = screen.getByRole('group', { name: 'Departure' });
  return within(picker)
    .getAllByRole('spinbutton')
    .map((section) => section.textContent)
    .join(' ');
}

async function fillValidTrip(user: UserEvent) {
  await chooseOrigin(user);
  await chooseDestination(user);
  await user.type(weightField(), '42000');
}

beforeEach(() => {
  // Only the clock is faked: timers, promises and MSW keep running for real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  answerPlansWith(planOk);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('trip form', () => {
  it('keeps Plan disabled until both places, the departure and the weight are valid', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(planButton()).toBeDisabled();

    await chooseOrigin(user);
    await chooseDestination(user);
    expect(planButton()).toBeDisabled();

    await user.type(weightField(), '42000');
    expect(planButton()).toBeEnabled();
  });

  it('groups the load weight with thousands separators as it is typed', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(weightField(), '1234567');

    expect(weightField()).toHaveValue('1,234,567');
  });

  it.each([
    ['0', 'Load weight must be greater than 0 lb.'],
    ['50001', 'Load weight can be at most 50,000 lb.'],
  ])('rejects a load weight of %s with a message under the field', async (typed, message) => {
    const user = userEvent.setup();
    renderApp();

    await user.type(weightField(), typed);

    expect(weightField()).toBeInvalid();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('accepts a load weight of exactly 50,000 lb', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.clear(weightField());
    await user.type(weightField(), '50000');

    expect(weightField()).toBeValid();
    expect(planButton()).toBeEnabled();
  });

  it('asks for the weight once the driver leaves the empty field, and disables Plan until then', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByText('Enter the load weight in pounds.')).not.toBeInTheDocument();

    await user.click(weightField());
    await user.tab();

    expect(screen.getByText('Enter the load weight in pounds.')).toBeInTheDocument();
    expect(planButton()).toBeDisabled();
  });

  it('refuses a destination that is the origin', async () => {
    const user = userEvent.setup();
    renderApp();
    await chooseOrigin(user);

    await choosePlace(user, 'Destination', 'Chicago', chicago.label);

    expect(screen.getByText('Destination must be different from the origin.')).toBeInTheDocument();
    expect(planButton()).toBeDisabled();
  });
});

describe('departure', () => {
  it('defaults to the next full hour, in the browser time zone until an origin is chosen', () => {
    renderApp();

    expect(departureText()).toBe('10 14 2026 11 00 AM');
    expect(screen.queryByText('PDT')).not.toBeInTheDocument();
  });

  it('follows the origin to the next full hour there while the driver has not picked a time', async () => {
    const user = userEvent.setup();
    renderApp();

    await chooseOrigin(user);

    expect(departureText()).toBe('10 14 2026 01 00 PM');
    expect(screen.getByText('CDT')).toBeInTheDocument();
  });

  it("keeps the picked clock time and re-labels it in the origin's zone when an origin is chosen", async () => {
    const requests = answerPlansWith(planOk);
    const user = userEvent.setup();
    renderApp();
    await typeDeparture(user, '10152026' + '0930' + 'A');
    expect(departureText()).toBe('10 15 2026 09 30 AM');

    await chooseOrigin(user);

    expect(departureText()).toBe('10 15 2026 09 30 AM');
    expect(screen.getByText('CDT')).toBeInTheDocument();
    await chooseDestination(user);
    await user.type(weightField(), '42000');
    await user.click(planButton());
    await screen.findByText('Route 1');
    // 9:30 on the clock in Chicago, not 9:30 Pacific shifted to Central.
    expect(requests[0].departure).toBe('2026-10-15T09:30:00-05:00');
  });

  it.each([
    ['a few days ahead', '10192026' + '0900' + 'A', "Departure can't be more than 48 hours ahead."],
    ['an hour ago', '10142026' + '0920' + 'A', "Departure can't be more than 15 minutes ago."],
  ])('blocks a departure %s', async (_name, keys, message) => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await typeDeparture(user, keys);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(planButton()).toBeDisabled();
  });

  it('accepts a departure inside the 15 minute grace and 48 hour horizon', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    // The origin is in Chicago, where "now" is 12:20 PM. 12:05 PM is exactly 15 minutes ago.
    await typeDeparture(user, '10142026' + '1205' + 'P');
    expect(planButton()).toBeEnabled();

    // 12:20 PM two days on is exactly 48 hours ahead.
    await typeDeparture(user, '10162026' + '1220' + 'P');
    expect(planButton()).toBeEnabled();
  });
});

describe('planning a trip', () => {
  it('sends the places, the departure with its offset and the weight in pounds', async () => {
    const requests = answerPlansWith(planOk);
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    await screen.findByText('Route 1');
    expect(requests).toEqual([
      {
        origin: chicago,
        destination: dallas,
        // The next full hour in Chicago, where it is 12:20 PM when the browser's clock says 10:20.
        departure: '2026-10-14T13:00:00-05:00',
        load_weight_lb: 42_000,
      },
    ]);
  });

  it('shows "Finding routes…" while the plan is worked out', async () => {
    let finish: () => void = () => undefined;
    answerPlansWith(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(HttpResponse.json(chicagoToDallas));
        }),
    );
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    // Twice: the results panel's progress line and the phone sheet's title, which share the words.
    expect(await screen.findAllByText('Finding routes…')).toHaveLength(2);
    expect(planButton()).toBeDisabled();
    finish();
    expect(await screen.findByText('Route 1')).toBeInTheDocument();
    expect(screen.queryByText('Finding routes…')).not.toBeInTheDocument();
  });

  it("gives every route a card with its distance, travel time and arrival in the origin's zone", async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    const first = (await screen.findByText('Route 1')).closest('button')!;
    expect(first).toHaveTextContent('927 mi');
    expect(first).toHaveTextContent('14 h 55 min');
    expect(first).toHaveTextContent('Arrives 10:54 PM CDT');
    expect(first).toHaveTextContent('Thu Oct 15');
    const third = screen.getByText('Route 3').closest('button')!;
    expect(third).toHaveTextContent('1,079 mi');
    expect(third).toHaveTextContent('16 h 13 min');
    expect(third).toHaveTextContent('Arrives 12:12 AM CDT');
    expect(third).toHaveTextContent('Fri Oct 16');
  });

  it('draws every route on the map with the first one selected', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    await screen.findByText('Route 1');
    const map = screen.getByRole('region', { name: 'Map' });
    expect(within(map).getByRole('button', { name: 'Route 1 on map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(map).getByRole('button', { name: 'Route 2 on map' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(map).getByRole('button', { name: 'Route 3 on map' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('highlights a route on the map when its card is pressed, and the card when the route is picked on the map', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);
    await user.click(planButton());
    const card = (n: number) => screen.getByText(`Route ${n}`).closest('button')!;
    const onMap = (n: number) => screen.getByRole('button', { name: `Route ${n} on map` });
    await screen.findByText('Route 1');

    await user.click(card(2));
    expect(card(2)).toHaveAttribute('aria-pressed', 'true');
    expect(onMap(2)).toHaveAttribute('aria-pressed', 'true');
    expect(card(1)).toHaveAttribute('aria-pressed', 'false');
    expect(onMap(1)).toHaveAttribute('aria-pressed', 'false');

    await user.click(onMap(3));
    expect(card(3)).toHaveAttribute('aria-pressed', 'true');
    expect(onMap(3)).toHaveAttribute('aria-pressed', 'true');
    expect(card(2)).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the fewer-than-three-routes notice', async () => {
    answerPlansWith(() =>
      HttpResponse.json({
        ...chicagoToDallas,
        routes: [routeOne],
        notices: [
          {
            code: 'fewer_than_three_routes',
            message: 'Only 1 distinct route exists between these places, not three.',
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    expect(
      await screen.findByText('Only 1 distinct route exists between these places, not three.'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      422,
      {
        code: 'no_route_found',
        message:
          'No truck route was found between these places. Try a different origin or destination.',
      },
    ],
    [
      503,
      {
        code: 'routing_unavailable',
        message: 'Route planning is unavailable right now. Please try again.',
      },
    ],
  ])('shows the API message when planning fails with %s', async (status, body) => {
    answerPlansWith(() => HttpResponse.json(body, { status }));
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);

    await user.click(planButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(body.message);
    expect(screen.queryByText('Route 1')).not.toBeInTheDocument();
  });

  it('replaces the routes shown when the trip is planned again', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValidTrip(user);
    await user.click(planButton());
    await screen.findByText('Route 3');

    answerPlansWith(() =>
      HttpResponse.json({
        ...chicagoToDallas,
        routes: [routeTwo, routeThree].map((r, i) => ({ ...r, id: `route-${i + 1}`, rank: i + 1 })),
      }),
    );
    await user.click(planButton());

    await vi.waitFor(() => expect(screen.queryByText('Route 3')).not.toBeInTheDocument());
    expect(screen.getByText('Route 2')).toBeInTheDocument();
  });
});
