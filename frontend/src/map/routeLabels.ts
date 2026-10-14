import type { PickingInfo } from '@deck.gl/core';
import { TextLayer } from '@deck.gl/layers';
import type { PlannedRoute } from '../api/plan';
import { formatAverageRisk, formatDuration, formatMilesExact } from '../trip/format';
import type { LngLat } from './polyline';
import { rgb, type RoutePath } from './routeLayers';

/** A route's label on the map: where it sits and what it says. */
export interface RouteLabel {
  routeId: string;
  text: string;
  position: LngLat;
}

// Where along each route its label sits, by the route's place in the plan: routes that share a
// road would pile their labels on the same spot if they all sat at the middle.
const LABEL_SHARES = [0.5, 0.33, 0.67];

/**
 * What a route's label says: its name, travel time and status on one line, and its risk
 * mileage and average risk on the next.
 */
export function routeLabelText(route: PlannedRoute, label: string, recommended: boolean): string {
  const { risk_miles: miles } = route;
  const status = recommended ? ' · Recommended' : route.blocked ? ' · Blocked' : '';
  const risk = [
    ...(route.blocked ? [`No Travel ${formatMilesExact(miles.no_travel)} mi`] : []),
    `Severe ${formatMilesExact(miles.severe)} mi`,
    `High ${formatMilesExact(miles.high)} mi`,
    `Avg risk ${formatAverageRisk(route.average_risk)}`,
  ];
  return `${label} · ${formatDuration(route.duration_seconds)}${status}\n${risk.join(' · ')}`;
}

/** The labels for the routes drawn on the map. `labels` maps route ids to `Route N`. */
export function routeLabelsFor(
  routes: PlannedRoute[],
  paths: RoutePath[],
  labels: Record<string, string>,
  recommendedRouteId: string | null,
): RouteLabel[] {
  return routes.flatMap((route, index) => {
    const path = paths.find(({ id }) => id === route.id)?.path;
    if (!path || path.length === 0) return [];
    return [
      {
        routeId: route.id,
        text: routeLabelText(route, labels[route.id], route.id === recommendedRouteId),
        position: pointAlong(path, LABEL_SHARES[index % LABEL_SHARES.length]),
      },
    ];
  });
}

/**
 * The point a `share` (0 to 1) of the way along `path`, measured in length: degrees of
 * longitude are shortened by the latitude, which is close enough to place a label.
 */
export function pointAlong(path: LngLat[], share: number): LngLat {
  const lengths = path.slice(1).map((end, index) => segmentLength(path[index], end));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0 || share <= 0) return path[0];
  if (share >= 1) return path[path.length - 1];

  let remaining = share * total;
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length) {
      const [from, to] = [path[index], path[index + 1]];
      const t = length === 0 ? 0 : remaining / length;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    remaining -= length;
  }
  return path[path.length - 1];
}

function segmentLength([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const eastWest = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(eastWest, lat2 - lat1);
}

const TEXT_COLOR = rgb('#1f2937');

/** The labels as a deck.gl layer; pressing one selects its route, like pressing the line. */
export function createRouteLabelLayer(
  labels: RouteLabel[],
  onSelectRoute: (id: string) => void,
) {
  return new TextLayer<RouteLabel>({
    id: 'route-labels',
    data: labels,
    getPosition: (label) => label.position,
    getText: (label) => label.text,
    getSize: 12,
    sizeUnits: 'pixels',
    getColor: TEXT_COLOR,
    fontFamily: '"Inter Variable", system-ui, sans-serif',
    fontWeight: 600,
    lineHeight: 1.25,
    characterSet: 'auto',
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    background: true,
    getBackgroundColor: [255, 255, 255, 240],
    backgroundPadding: [6, 3],
    getBorderColor: [107, 114, 128],
    getBorderWidth: 1,
    pickable: true,
    onClick: ({ object }: PickingInfo<RouteLabel>) => {
      if (object) onSelectRoute(object.routeId);
    },
  });
}
