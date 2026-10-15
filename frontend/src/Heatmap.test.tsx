import { screen, within } from '@testing-library/react';
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

/** The slider's label: the clock time at the origin, and the hours after departure beside it. */
function expectLabel(clock: string, offset: string) {
  // Scoped to the strip: "Departure" is also the name of the departure field.
  const controls = within(screen.getByRole('region', { name: 'Forecast controls' }));
  expect(controls.getByText(clock)).toBeInTheDocument();
  expect(controls.getByText(offset)).toBeInTheDocument();
}

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

  it('labels the slider with the clock time at the origin and the hours after departure', async () => {
    answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    expectLabel('Thu 8:00 AM CDT', 'Departure');

    hours.focus();
    await user.keyboard('{ArrowRight}');
    expectLabel('Thu 9:00 AM CDT', '+1 h');

    await user.keyboard('{ArrowRight>13/}');
    expectLabel('Thu 10:00 PM CDT', '+14 h');

    await user.keyboard('{End}');
    expectLabel('Sat 8:00 AM CDT', '+48 h');
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

    expectLabel('Thu 11:00 AM CDT', '+3 h');
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

    await vi.waitFor(() => expectLabel('Thu 8:00 AM CDT', 'Departure'));
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

describe('the heatmap layer toggle', () => {
  const legend = () => screen.getByRole('group', { name: 'Heatmap legend' });
  const layerButton = (name: string) => screen.getByRole('button', { name });

  it('shows combined risk to begin with, with the risk bands in the legend', async () => {
    answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    await slider();

    expect(layerButton('Risk')).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Wind', 'Rain', 'Snow']) {
      expect(layerButton(name)).toHaveAttribute('aria-pressed', 'false');
    }
    for (const band of ['Low', 'Moderate', 'High', 'Severe', 'No Travel']) {
      expect(within(legend()).getByText(band)).toBeInTheDocument();
    }
  });

  it('switches the legend to the raw weather, with its units and its top value', async () => {
    answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    await slider();

    await user.click(layerButton('Wind'));
    expect(layerButton('Wind')).toHaveAttribute('aria-pressed', 'true');
    expect(layerButton('Risk')).toHaveAttribute('aria-pressed', 'false');
    expect(within(legend()).getByText('Wind speed (mph)')).toBeInTheDocument();
    expect(within(legend()).getByText('60+')).toBeInTheDocument();
    expect(within(legend()).queryByText('Moderate')).not.toBeInTheDocument();

    await user.click(layerButton('Rain'));
    expect(within(legend()).getByText('Rain rate (in/hr)')).toBeInTheDocument();
    expect(within(legend()).getByText('1.2+')).toBeInTheDocument();

    await user.click(layerButton('Snow'));
    expect(within(legend()).getByText('Snowfall rate (in/hr)')).toBeInTheDocument();
    expect(within(legend()).getByText('3.5+')).toBeInTheDocument();

    await user.click(layerButton('Risk'));
    expect(within(legend()).getByText('Moderate')).toBeInTheDocument();
  });

  it('keeps the hour and asks the server for nothing when the layer changes', async () => {
    const requests = answerWith(heatmapOk);
    const user = userEvent.setup();
    renderApp();

    await planChicagoToDallas(user);
    const hours = await slider();
    hours.focus();
    await user.keyboard('{ArrowRight>5/}');

    await user.click(layerButton('Snow'));
    await user.click(layerButton('Rain'));

    expect(screen.getByRole('img', { name: 'Forecast heatmap' })).toHaveTextContent('rain layer');
    expectLabel('Thu 1:00 PM CDT', '+5 h');
    expect(requests).toHaveLength(1);
  });
});
