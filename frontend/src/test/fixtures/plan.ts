import type { Checkpoint, CheckpointRisk, Plan, PlannedRoute } from '../../api/plan';

// Any valid encoded polyline will do: page tests never draw it.
const GEOMETRY = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
// One value per vertex of the geometry above: three vertices.
const ELAPSED = [0, 20_000, 53_684];

/** Nothing to worry about. */
const LOW: CheckpointRisk = {
  level: 'low',
  score: 0,
  conditions: { wind: 'low', rain: 'low', snow: 'low' },
  driving: [],
  combined: [],
  gust_warning: null,
  wind_raised_by_load: false,
};

/** Snow at 0.5 in/hr is Moderate, and nothing else is. */
const MODERATE_SNOW: CheckpointRisk = {
  ...LOW,
  level: 'moderate',
  score: 1,
  conditions: { wind: 'low', rain: 'low', snow: 'moderate' },
  driving: ['snow'],
};

/** No forecast: not Low. */
const NO_DATA: CheckpointRisk = {
  level: 'no_data',
  score: null,
  conditions: { wind: null, rain: null, snow: null },
  driving: [],
  combined: [],
  gust_warning: null,
  wind_raised_by_load: false,
};

/**
 * Wind of 39 mph is High, and Severe for the 42,000 lb load the page tests plan with; snow is
 * Moderate, so the two combine; gusts of 52 mph would be No Travel for that load.
 */
const SEVERE_WIND_AND_SNOW: CheckpointRisk = {
  level: 'severe',
  score: 3.5,
  conditions: { wind: 'severe', rain: 'low', snow: 'moderate' },
  driving: ['wind'],
  combined: ['wind', 'snow'],
  gust_warning: { gust_mph: 52, level: 'no_travel' },
  wind_raised_by_load: true,
};

/**
 * The first checkpoints of a route that leaves Chicago at 08:00 CDT, every 25 mi. The real
 * answer has one every 25 mi to Dallas; a few are enough for the page to show.
 */
const everyTwentyFiveMiles: Checkpoint[] = [
  {
    mile: 0,
    lat: 41.88425,
    lng: -87.63245,
    eta: '2026-10-15T08:00:00-05:00',
    covered_miles: 12.5,
    weather: { wind_mph: 12.4, gust_mph: 21.7, rain_in_hr: 0, snow_in_hr: 0 },
    risk: LOW,
  },
  {
    mile: 25,
    lat: 41.60912,
    lng: -87.96127,
    eta: '2026-10-15T08:31:12-05:00',
    covered_miles: 25,
    weather: { wind_mph: 18.2, gust_mph: 29.6, rain_in_hr: 0.034, snow_in_hr: 0.5 },
    risk: MODERATE_SNOW,
  },
  {
    mile: 50,
    lat: 41.45133,
    lng: -88.31544,
    eta: '2026-10-15T09:04:51-05:00',
    covered_miles: 25,
    // Open-Meteo had no forecast for this hour.
    weather: null,
    risk: NO_DATA,
  },
];

/** A forecast with every value but the gust. */
const WITHOUT_GUSTS = { wind_mph: 9, gust_mph: null, rain_in_hr: 0, snow_in_hr: 0 };

/** The same route sampled every 10 mi, after the driver asks for finer detail. */
const everyTenMiles: Checkpoint[] = [
  {
    mile: 0,
    lat: 41.88425,
    lng: -87.63245,
    eta: '2026-10-15T08:00:00-05:00',
    covered_miles: 5,
    weather: WITHOUT_GUSTS,
    risk: LOW,
  },
  {
    mile: 10,
    lat: 41.7421,
    lng: -87.80813,
    eta: '2026-10-15T08:12:40-05:00',
    covered_miles: 10,
    weather: WITHOUT_GUSTS,
    risk: LOW,
  },
  {
    mile: 20,
    lat: 41.63071,
    lng: -87.9442,
    eta: '2026-10-15T08:25:03-05:00',
    covered_miles: 10,
    weather: { wind_mph: 39, gust_mph: 52, rain_in_hr: 0, snow_in_hr: 0.6 },
    risk: SEVERE_WIND_AND_SNOW,
  },
];

const NO_MILES = { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0, unassessed: 0 };

/**
 * Values from the recorded HERE answer for Chicago to Dallas, in the shape the API returns.
 * Route 1 is the recommended one: no Severe or High miles and the lowest average risk. Route 2
 * is quicker but has High miles and a higher average risk; route 3 passes through No Travel.
 */
export const routeOne: PlannedRoute = {
  id: 'route-1',
  distance_miles: 926.83,
  duration_seconds: 53_684,
  arrival: '2026-10-15T22:54:44-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
  risk_miles: { ...NO_MILES, low: 800, moderate: 100, unassessed: 26.8 },
  average_risk: 0.45,
  blocked: false,
  rank: 1,
  deciding: null,
};

export const routeTwo: PlannedRoute = {
  id: 'route-2',
  distance_miles: 968.76,
  duration_seconds: 53_300,
  arrival: '2026-10-15T22:48:20-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
  risk_miles: { ...NO_MILES, low: 700, moderate: 150, high: 50, unassessed: 68.8 },
  average_risk: 0.9,
  blocked: false,
  rank: 2,
  deciding: {
    criterion: 'high_miles',
    recommended_value: 0,
    alternative_value: 50,
    best_average_risk: null,
  },
};

export const routeThree: PlannedRoute = {
  id: 'route-3',
  distance_miles: 1_079.36,
  duration_seconds: 58_366,
  arrival: '2026-10-16T00:12:46-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
  risk_miles: { ...NO_MILES, low: 900, moderate: 100, high: 50, no_travel: 29.4 },
  average_risk: 0.5,
  blocked: true,
  rank: 3,
  deciding: {
    criterion: 'blocked',
    recommended_value: 0,
    alternative_value: 29.4,
    best_average_risk: null,
  },
};

export const chicagoToDallas: Plan = {
  origin_time_zone: 'America/Chicago',
  departure: '2026-10-15T08:00:00-05:00',
  interval_miles: 25,
  interval_automatic: true,
  routes: [routeOne, routeTwo, routeThree],
  recommended_route_id: 'route-1',
  all_blocked_warning: null,
  notices: [],
};

/**
 * The same trip when a storm sits on route-1: it gets 50 Severe miles, so the slower route-2
 * is recommended and ranks first. The plan still lists them by id, but the cards number routes
 * by rank, so route-2 reads "Route 1" and route-1 reads "Route 2". route-3 is still blocked.
 */
export const chicagoToDallasStormOnRouteOne: Plan = {
  ...chicagoToDallas,
  routes: [
    {
      ...routeOne,
      risk_miles: { ...NO_MILES, low: 700, moderate: 100, high: 50, severe: 50, unassessed: 26.8 },
      average_risk: 1.2,
      rank: 2,
      deciding: {
        criterion: 'severe_miles',
        recommended_value: 0,
        alternative_value: 50,
        best_average_risk: null,
      },
    },
    { ...routeTwo, rank: 1, deciding: null },
    routeThree,
  ],
  recommended_route_id: 'route-2',
};

/** Every route passes through No Travel conditions at this departure time. */
export const chicagoToDallasAllBlocked: Plan = {
  ...chicagoToDallas,
  routes: [
    {
      ...routeOne,
      blocked: true,
      risk_miles: { ...routeOne.risk_miles, no_travel: 25 },
      rank: 1,
      deciding: null,
    },
    {
      ...routeTwo,
      blocked: true,
      risk_miles: { ...routeTwo.risk_miles, no_travel: 50 },
      rank: 2,
      deciding: null,
    },
    { ...routeThree, rank: 3, deciding: null },
  ],
  recommended_route_id: null,
  all_blocked_warning: {
    code: 'all_routes_blocked',
    message:
      'Do not travel at this departure time. Every route passes through No Travel conditions; try another departure time.',
  },
};

/** The plan again, after the driver overrides the interval with 10 mi. */
export const chicagoToDallasEveryTenMiles: Plan = {
  ...chicagoToDallas,
  interval_miles: 10,
  interval_automatic: false,
  routes: chicagoToDallas.routes.map((route) => ({ ...route, checkpoints: everyTenMiles })),
};
