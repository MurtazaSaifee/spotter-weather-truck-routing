import type { Plan, PlannedRoute } from '../../api/plan';

// Any valid encoded polyline will do: page tests never draw it.
const GEOMETRY = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

/** Values from the recorded HERE answer for Chicago to Dallas, in the shape the API returns. */
export const routeOne: PlannedRoute = {
  id: 'route-1',
  distance_miles: 926.83,
  duration_seconds: 53_684,
  arrival: '2026-10-15T22:54:44-05:00',
  geometry: GEOMETRY,
};

export const routeTwo: PlannedRoute = {
  id: 'route-2',
  distance_miles: 968.76,
  duration_seconds: 53_300,
  arrival: '2026-10-15T22:48:20-05:00',
  geometry: GEOMETRY,
};

export const routeThree: PlannedRoute = {
  id: 'route-3',
  distance_miles: 1_079.36,
  duration_seconds: 58_366,
  arrival: '2026-10-16T00:12:46-05:00',
  geometry: GEOMETRY,
};

export const chicagoToDallas: Plan = {
  origin_time_zone: 'America/Chicago',
  departure: '2026-10-15T08:00:00-05:00',
  routes: [routeOne, routeTwo, routeThree],
  notices: [],
};
