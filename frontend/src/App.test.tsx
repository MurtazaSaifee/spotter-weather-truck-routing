import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from './test/renderApp';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

describe('App', () => {
  it('renders the map area next to the planner panel', async () => {
    renderApp();

    expect(await screen.findByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weather-Aware Truck Routing' }),
    ).toBeInTheDocument();
  });
});
