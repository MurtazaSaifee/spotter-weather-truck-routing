import { theme } from '../theme';

// The route constants TripMap reads when it picks and styles routes. They live apart from
// routeLayers.ts, which imports deck.gl: TripMap loads with the map, and deck.gl waits until
// there is something to draw (see DeckMapLayers.tsx).

/**
 * A recommended route that is not selected is drawn in this and its label is bordered in it, so
 * the selected route's blue is the only highlight on the map. One constant keeps the line and
 * the label from drifting apart.
 */
export const RECOMMENDED_ROUTE_COLOR = theme.palette.grey[700];
// Routes are thin lines, so let a click land a few pixels off one.
export const ROUTE_PICKING_RADIUS_PX = 8;
// On a touch screen the finger is wider than the line.
export const TOUCH_PICKING_RADIUS_PX = 16;
/** The ids of the layers that draw a route's line: what a click on one of them selects. */
export const ROUTE_LAYER_IDS: ReadonlySet<string> = new Set([
  'routes',
  'routes-blocked',
  'recommended-route',
  'selected-route',
  'selected-route-blocked',
]);
