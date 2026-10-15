import { describe, expect, it } from 'vitest';
import { chicagoToDallas, chicagoToDallasStormOnRouteOne } from '../test/fixtures/plan';
import { routeLabels } from './ranking';

describe('route labels', () => {
  it('number the routes by rank, so the best route is Route 1', () => {
    expect(routeLabels(chicagoToDallas.routes)).toEqual({
      'route-1': 'Route 1',
      'route-2': 'Route 2',
      'route-3': 'Route 3',
    });
  });

  it('follow the rank and not the order the plan lists the routes in', () => {
    // The plan lists route 1 first, but the storm on it ranks it second.
    expect(routeLabels(chicagoToDallasStormOnRouteOne.routes)).toEqual({
      'route-1': 'Route 2',
      'route-2': 'Route 1',
      'route-3': 'Route 3',
    });
  });
});
