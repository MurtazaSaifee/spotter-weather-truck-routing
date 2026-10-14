import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeatmapRequest } from './api/heatmap';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas, chicagoToDallasEveryTenMiles } from './test/fixtures/plan';
import { heatmapOfChicagoToDallas } from './test/fixtures/heatmap';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const HEATMAP_PATH = '/api/heatmap';

const NOW = new Date('2026-10-14T17:20:00Z');

/** Answers suggestions and plans, and records every heatmap request. */
function answerWith(heatmap: () => Response | Promise<Response>) {
  const heatmapRequests: HeatmapRequest[] = [];
  let plans = 0;
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', () =>
      HttpResponse.json(plans++ === 0 ? chicagoToDallas : chicagoToDallasEveryTenMiles),
    ),
    http.post(HEATMAP_PATH, async ({ request }) => {
      heatmapRequests.push((await request.json()) as HeatmapRequest);
      return heatmap();
    }),
  );
  return heatmapRequests;
}

const heatmapOk = () => HttpResponse.json(heatmapOfChicagoToDallas);

async function planChicagoToDallas(user: UserEvent) {
  await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');
  await user.click(await screen.findByRole('option', { name: chicago.label }));
  await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Dallas');
  await user.click(await screen.findByRole('option', { name: dallas.label }));
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
}

const slider = () => screen.findByRole('slider', { name: 'Hours after departure' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the forecast heatmap', () => {
  it('asks for the heatmap of the displayed routes, with the departure and the load', async () => {
    const requests = answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    await slider();

    expect(requests).toEqual([
      {
        geometries: chicagoToDallas.routes.map((route) => route.geometry),
        departure: chicagoToDallas.departure,
        load_weight_lb: 42000,
      },
    ]);
  });

  it('shows the routes while the forecasts are being checked, then the slider', async () => {
    answerWith(async () => {
      await delay(50);
      return heatmapOk();
    });
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);

    expect(await screen.findByText('Checking forecasts…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Route 1 on map' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    await slider();
    expect(screen.queryByText('Checking forecasts…')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Forecast heatmap' })).toHaveTextContent('49 frames');
  });

  it('labels the slider with the hours after departure and the clock time at the origin', async () => {
    answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    expect(screen.getByText('T+0h · Thu 08:00 CDT')).toBeInTheDocument();

    hours.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('T+1h · Thu 09:00 CDT')).toBeInTheDocument();

    await user.keyboard('{ArrowRight>13/}');
    expect(screen.getByText('T+14h · Thu 22:00 CDT')).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(screen.getByText('T+48h · Sat 08:00 CDT')).toBeInTheDocument();
  });

  it('does not ask the server again as the slider moves', async () => {
    const requests = answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    hours.focus();
    await user.keyboard('{ArrowRight>5/}');

    expect(requests).toHaveLength(1);
  });

  it('keeps the heatmap and the hour when the sampling interval changes', async () => {
    const requests = answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    hours.focus();
    await user.keyboard('{ArrowRight>3/}');

    const ten = screen.getByRole('button', { name: '10 mi' });
    await user.click(ten);
    await vi.waitFor(() => expect(ten).toHaveAttribute('aria-pressed', 'true'));

    expect(screen.getByText('T+3h · Thu 11:00 CDT')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it('starts at departure again when a new trip is planned', async () => {
    answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    hours.focus();
    await user.keyboard('{ArrowRight>3/}');

    await user.click(screen.getByRole('button', { name: 'Plan trip' }));

    expect(await screen.findByText('T+0h · Thu 08:00 CDT')).toBeInTheDocument();
  });

  it('offers a retry when the heatmap cannot be loaded, leaving the routes in place', async () => {
    let attempts = 0;
    const requests = answerWith(() =>
      attempts++ === 0
        ? HttpResponse.json(
            { code: 'weather_unavailable', message: 'Forecasts are unavailable.' },
            { status: 503 },
          )
        : heatmapOk(),
    );
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The forecast heatmap could not be loaded.',
    );
    expect(screen.getByRole('button', { name: 'Route 1 on map' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await slider();
    expect(requests).toHaveLength(2);
  });
});
