import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const API_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.';

function failHealthCheck() {
  server.use(
    http.get('/api/health', () =>
      HttpResponse.json({ code: 'internal_error', message: API_ERROR_MESSAGE }, { status: 503 }),
    ),
  );
}

describe('App', () => {
  it('shows that the API is healthy when the health check succeeds', async () => {
    renderApp();

    expect(await screen.findByText('API healthy')).toBeInTheDocument();
  });

  it("shows the API's error message and a Retry button when the health check fails", async () => {
    failHealthCheck();

    renderApp();

    expect(await screen.findByText(API_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the API as healthy after Retry once the server has recovered', async () => {
    failHealthCheck();
    const user = userEvent.setup();
    renderApp();
    const retry = await screen.findByRole('button', { name: 'Retry' });

    server.use(http.get('/api/health', () => HttpResponse.json({ status: 'ok' })));
    await user.click(retry);

    expect(await screen.findByText('API healthy')).toBeInTheDocument();
  });

  it('renders the map area next to the planner panel', async () => {
    renderApp();

    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weather-Aware Truck Routing' }),
    ).toBeInTheDocument();
  });
});
