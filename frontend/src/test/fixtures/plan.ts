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

/** Values from the recorded HERE answer for Chicago to Dallas, in the shape the API returns. */
export const routeOne: PlannedRoute = {
  id: 'route-1',
  distance_miles: 926.83,
  duration_seconds: 53_684,
  arrival: '2026-10-15T22:54:44-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
};

export const routeTwo: PlannedRoute = {
  id: 'route-2',
  distance_miles: 968.76,
  duration_seconds: 53_300,
  arrival: '2026-10-15T22:48:20-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
};

export const routeThree: PlannedRoute = {
  id: 'route-3',
  distance_miles: 1_079.36,
  duration_seconds: 58_366,
  arrival: '2026-10-16T00:12:46-05:00',
  geometry: GEOMETRY,
  elapsed_seconds: ELAPSED,
  checkpoints: everyTwentyFiveMiles,
};

export const chicagoToDallas: Plan = {
  origin_time_zone: 'America/Chicago',
  departure: '2026-10-15T08:00:00-05:00',
  interval_miles: 25,
  interval_automatic: true,
  routes: [routeOne, routeTwo, routeThree],
  notices: [],
};

/** The plan again, after the driver overrides the interval with 10 mi. */
export const chicagoToDallasEveryTenMiles: Plan = {
  ...chicagoToDallas,
  interval_miles: 10,
  interval_automatic: false,
  routes: chicagoToDallas.routes.map((route) => ({ ...route, checkpoints: everyTenMiles })),
};
