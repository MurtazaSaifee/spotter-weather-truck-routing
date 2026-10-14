import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas } from './test/fixtures/plan';
import { heatmapOfChicagoToDallas } from './test/fixtures/heatmap';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom. The truck itself is drawn on the
// map, which the page cannot see here; what the page shows of it is its state in words.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const NOW = new Date('2026-10-14T17:20:00Z');

// The fixture routes share a three-vertex line that is reached at 0 s, 20,000 s and the route's
// duration (53,684 s, so 14 h 54 min). Route 1 is 926.83 mi, route 2 is 968.76 mi. Miles are
// measured along the line (297 and 630 mi in the two legs, by great-circle distance) and scaled
// to those lengths: one hour in is 3,600/20,000 of the first leg, and so on.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', () => HttpResponse.json(chicagoToDallas)),
    http.post('/api/heatmap', () => HttpResponse.json(heatmapOfChicagoToDallas)),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

async function planChicagoToDallas(user: UserEvent) {
  await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');
  await user.click(await screen.findByRole('option', { name: chicago.label }));
  await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Dallas');
  await user.click(await screen.findByRole('option', { name: dallas.label }));
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
}

async function scrubbable(user: UserEvent) {
  await planChicagoToDallas(user);
  const hours = await screen.findByRole('slider', { name: 'Hours after departure' });
  hours.focus();
  return hours;
}

describe('the truck on the selected route', () => {
  it('starts at the origin when the forecast is shown', async () => {
    const user = userEvent.setup();
    renderApp();

    await scrubbable(user);

    expect(screen.getByText('At origin')).toBeInTheDocument();
  });

  it('says how far along the route the truck is at the hour on the slider', async () => {
    const user = userEvent.setup();
    renderApp();
    await scrubbable(user);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('En route · mile 53')).toBeInTheDocument();

    await user.keyboard('{ArrowRight>13/}');
    expect(screen.getByText('En route · mile 865')).toBeInTheDocument();
  });

  it('has arrived once the slider passes the arrival time, and stays there', async () => {
    const user = userEvent.setup();
    renderApp();
    await scrubbable(user);

    // The route takes 14 h 54 min: 14 h is still en route, 15 h is past it.
    await user.keyboard('{ArrowRight>15/}');
    expect(screen.getByText('Arrived')).toBeInTheDocument();
    expect(screen.queryByText(/En route/)).not.toBeInTheDocument();

    await user.keyboard('{End}');
    expect(screen.getByText('Arrived')).toBeInTheDocument();

    await user.keyboard('{Home}');
    expect(screen.getByText('At origin')).toBeInTheDocument();
  });

  it('follows the selected route, keeping the hour', async () => {
    const user = userEvent.setup();
    renderApp();
    await scrubbable(user);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('En route · mile 53')).toBeInTheDocument();

    // Route 2 is longer (968.76 mi against 926.83 mi) over the same line and times.
    await user.click(screen.getByRole('button', { name: 'Route 2 on map' }));

    expect(screen.getByText('En route · mile 56')).toBeInTheDocument();
  });
});
