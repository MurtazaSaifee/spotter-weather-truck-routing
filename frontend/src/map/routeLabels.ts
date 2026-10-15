import type { PickingInfo } from '@deck.gl/core';
import { TextLayer } from '@deck.gl/layers';
import type { PlannedRoute } from '../api/plan';
import { theme } from '../theme';
import { formatAverageRisk, formatDuration, formatMilesExact } from '../trip/format';
import type { LngLat } from './polyline';
import { rgb } from './colour';
import { RECOMMENDED_ROUTE_COLOR } from './routeLayers';

/** A route's label on the map: where it sits and what it says. */
export interface RouteLabel {
  routeId: string;
  text: string;
  position: LngLat;
  tone: LabelTone;
}

export type LabelTone = 'selected' | 'recommended' | 'blocked' | 'plain';

/** `brief` keeps the name, time and status; `full` adds the average risk (or No Travel miles). */
type LabelDetail = 'brief' | 'full';

interface LabelTextOptions {
  recommended: boolean;
  detail: LabelDetail;
}

/**
 * What a route's label says. The first line is its name and travel time. The second is its
 * status (Recommended or Blocked) and, when there is room, the one number that summarises its
 * risk: the average risk, or for a blocked route how much of it is No Travel. The cards carry
 * the full mileage breakdown.
 */
export function routeLabelText(
  route: PlannedRoute,
  label: string,
  { recommended, detail }: LabelTextOptions,
): string {
  const status = recommended ? 'Recommended' : route.blocked ? 'Blocked' : null;
  const risk =
    detail === 'full'
      ? route.blocked
        ? `No Travel ${formatMilesExact(route.risk_miles.no_travel)} mi`
        : `Avg risk ${formatAverageRisk(route.average_risk)}`
      : null;
  // A recommended route is never blocked, so the status and the risk never repeat each other.
  const second = [status, risk].filter(Boolean).join(' · ');
  const first = `${label} · ${formatDuration(route.duration_seconds)}`;
  return second ? `${first}\n${second}` : first;
}

const CHARACTER_WIDTH_PX = 6.9;
const LINE_HEIGHT_PX = 15;
const PADDING_X_PX = 8;
const PADDING_Y_PX = 4;

/** The pixels a label's text and padding take up: close enough to keep two labels apart. */
export function labelSize(text: string): [number, number] {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  return [
    Math.ceil(longest * CHARACTER_WIDTH_PX + 2 * PADDING_X_PX),
    lines.length * LINE_HEIGHT_PX + 2 * PADDING_Y_PX,
  ];
}

/** What the placement needs to know about the map as it is now. */
export interface LabelView {
  /** Longitude and latitude to pixels in the map's container. */
  project: (point: LngLat) => [number, number];
  width: number;
  height: number;
  /** Parts of the map something else covers, such as a bottom sheet. */
  padding?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
}

interface LabelCandidate {
  id: string;
  path: LngLat[];
  size: [number, number];
  /** Placed first when higher: the selected route gets the best spot. */
  priority: number;
}

// Space kept between a label and the edge of the map, and between two labels.
const EDGE_MARGIN_PX = 8;
const LABEL_GAP_PX = 6;
// A pin stands on each end of a route, about this wide and this tall above its point: a label
// there would hide it.
const PIN_HALF_WIDTH_PX = 18;
const PIN_HEIGHT_PX = 48;
const SAMPLE_STEP_PX = 8;
const MAX_SAMPLES = 600;
// A point of a route closer than this to the one before it adds nothing to the shape.
const SIMPLIFY_PX = 3;
// A stale position is kept if its route is still at least this clear of the others.
const KEEP_CLEARANCE = 0.75;

type Point = [number, number];
interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where to put each route's label so that the map reads at a glance: on a stretch where the
 * route is well apart from the others (routes share roads, and a label there would belong to
 * all of them), inside the visible map, clear of the pins and of the other labels.
 *
 * Works in screen pixels, so what "apart" and "overlapping" mean follows the zoom. Labels are
 * placed highest priority first, and a route with no room left gets none. `previous` holds the
 * positions from the last call: a label stays where it was while that is still clear, so
 * panning and zooming do not make labels hop.
 */
export function placeLabels(
  routes: LabelCandidate[],
  view: LabelView,
  previous: Record<string, LngLat> = {},
): Record<string, LngLat> {
  const projected = new Map(routes.map(({ id, path }) => [id, simplify(path.map(view.project))]));
  const placed: Rect[] = [...projected.values()].flatMap((line) =>
    line.length === 0 ? [] : [pinRect(line[0]), pinRect(line[line.length - 1])],
  );
  const result: Record<string, LngLat> = {};

  const ordered = routes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => b.route.priority - a.route.priority || a.index - b.index);

  for (const { route } of ordered) {
    const screen = projected.get(route.id)!;
    const others = routes.filter(({ id }) => id !== route.id).map(({ id }) => projected.get(id)!);
    const [width, height] = route.size;
    const clearAt = Math.hypot(width, height) / 2 + LABEL_GAP_PX;
    const area = visibleArea(view, route.size);
    const rectAt = ([x, y]: Point): Rect => ({
      left: x - width / 2,
      right: x + width / 2,
      top: y - height / 2,
      bottom: y + height / 2,
    });
    const free = (point: Point) =>
      inside(point, area) && placed.every((other) => !touching(rectAt(point), other));
    const clearance = (point: Point) =>
      Math.min(clearAt, ...others.map((line) => distanceToLine(point, line)));

    let best: { point: Point; lngLat: LngLat; score: number } | null = null;
    const consider = (point: Point, lngLat: LngLat, bonus: number) => {
      if (!free(point)) return;
      const score = clearance(point) + bonus;
      if (!best || score > best.score) best = { point, lngLat, score };
    };

    const stale = previous[route.id];
    if (stale) {
      const point = view.project(stale);
      if (clearance(point) >= clearAt * KEEP_CLEARANCE) consider(point, stale, 2 * clearAt);
    }
    const samples = sample(route.path, screen, view.project);
    for (const { point, lngLat, along } of samples) {
      // Among equally clear spots the middle of the route reads best, and is steadiest.
      consider(point, lngLat, (1 - Math.abs(along - 0.5) * 2) * 4);
    }

    const chosen = best as { point: Point; lngLat: LngLat } | null;
    if (!chosen) continue;
    result[route.id] = chosen.lngLat;
    placed.push(padded(rectAt(chosen.point), LABEL_GAP_PX / 2));
  }
  return result;
}

const pinRect = ([x, y]: Point): Rect => ({
  left: x - PIN_HALF_WIDTH_PX,
  right: x + PIN_HALF_WIDTH_PX,
  top: y - PIN_HEIGHT_PX,
  bottom: y + LABEL_GAP_PX,
});

/** Where a label's centre may be: inside the map and its padding, with the label wholly in. */
function visibleArea(view: LabelView, [width, height]: [number, number]): Rect {
  const { top = 0, right = 0, bottom = 0, left = 0 } = view.padding ?? {};
  return {
    left: left + EDGE_MARGIN_PX + width / 2,
    right: view.width - right - EDGE_MARGIN_PX - width / 2,
    top: top + EDGE_MARGIN_PX + height / 2,
    bottom: view.height - bottom - EDGE_MARGIN_PX - height / 2,
  };
}

const inside = ([x, y]: Point, area: Rect) =>
  x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;

const touching = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const padded = (rect: Rect, by: number): Rect => ({
  left: rect.left - by,
  right: rect.right + by,
  top: rect.top - by,
  bottom: rect.bottom + by,
});

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The line without the vertices that sit within a few pixels of the one before. */
function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const kept: Point[] = [points[0]];
  for (const point of points.slice(1, -1))
    if (distance(point, kept[kept.length - 1]) >= SIMPLIFY_PX) kept.push(point);
  kept.push(points[points.length - 1]);
  return kept;
}

function distanceToLine(point: Point, line: Point[]): number {
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    nearest = Math.min(nearest, distanceToSegment(point, line[i - 1], line[i]));
  }
  return nearest;
}

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Sample {
  point: Point;
  lngLat: LngLat;
  /** How far along the route, from 0 to 1, by screen length. */
  along: number;
}

/** Points along a route every few pixels, each with the position it has on the map. */
function sample(path: LngLat[], screen: Point[], project: LabelView['project']): Sample[] {
  const line = path.map((lngLat) => ({ lngLat, point: project(lngLat) }));
  const lengths = line.slice(1).map((end, i) => distance(line[i].point, end.point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0 || screen.length === 0) return [];
  const step = Math.max(SAMPLE_STEP_PX, total / MAX_SAMPLES);

  const samples: Sample[] = [];
  let travelled = 0;
  let next = 0;
  for (const [i, length] of lengths.entries()) {
    for (; next <= travelled + length; next += step) {
      const t = length === 0 ? 0 : (next - travelled) / length;
      const [from, to] = [line[i], line[i + 1]];
      samples.push({
        point: [
          from.point[0] + (to.point[0] - from.point[0]) * t,
          from.point[1] + (to.point[1] - from.point[1]) * t,
        ],
        lngLat: [
          from.lngLat[0] + (to.lngLat[0] - from.lngLat[0]) * t,
          from.lngLat[1] + (to.lngLat[1] - from.lngLat[1]) * t,
        ],
        along: next / total,
      });
    }
    travelled += length;
  }
  return samples;
}

const { palette } = theme;
const TEXT_COLOR = rgb(palette.text.primary);
// The same colours as the route lines (see TripMap); a blocked route's is the error red. Only the
// selected route's is blue.
const BORDER_COLORS: Record<LabelTone, [number, number, number]> = {
  selected: rgb(palette.primary.main),
  recommended: rgb(RECOMMENDED_ROUTE_COLOR),
  blocked: rgb(palette.error.main),
  plain: rgb(palette.grey[500]),
};
const BORDER_WIDTHS: Record<LabelTone, number> = {
  selected: 2,
  recommended: 1.5,
  blocked: 1.5,
  plain: 1,
};

/**
 * The labels as a deck.gl layer; pressing one selects its route, like pressing the line. Where
 * they sit is `placeLabels`' business: deck.gl's own collision filter was tried and dropped,
 * as it hid every label once the map re-rendered in the interleaved overlay.
 */
export function createRouteLabelLayer(labels: RouteLabel[], onSelectRoute: (id: string) => void) {
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
    getBackgroundColor: [255, 255, 255, 245],
    backgroundPadding: [PADDING_X_PX, PADDING_Y_PX],
    backgroundBorderRadius: 6,
    getBorderColor: (label) => BORDER_COLORS[label.tone],
    getBorderWidth: (label) => BORDER_WIDTHS[label.tone],
    pickable: true,
    onClick: ({ object }: PickingInfo<RouteLabel>) => {
      if (object) onSelectRoute(object.routeId);
    },
  });
}
