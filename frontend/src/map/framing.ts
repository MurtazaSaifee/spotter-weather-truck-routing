import type { CSSProperties } from 'react';
import { TOUCH_TARGET } from '../theme';
import type { LngLat } from './polyline';
import type { RoutePath } from './routeLayers';

// Breathing room around fitted bounds, per side, as a share of the room the map has left once
// its covered parts are taken off. A fixed pixel padding swallows a narrow map and zooms out
// far past the data.
const FIT_PADDING_RATIO = 0.12;
// A pin stands 42 px above the point it marks, so the top needs at least that much room.
const PIN_CLEARANCE_PX = 56;

// MapLibre's controls (zoom, compass, attribution) sit in a column at the map's right edge,
// set in by this margin (its own CSS). The buttons are touch-sized (see MapStyles).
const CONTROL_MARGIN_PX = 10;
/** Width of the column of map controls along the right edge, which nothing should sit under. */
export const CONTROL_COLUMN_PX = TOUCH_TARGET + CONTROL_MARGIN_PX;

/** Pixels at each edge of the map that something else covers, such as a bottom sheet. */
export type Insets = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;

export type Bounds = [LngLat, LngLat];

/** The lower 48 states: what the map shows before there is a trip. */
export const CONTINENTAL_US: Bounds = [
  [-125, 24.5],
  [-66.9, 49.5],
];

/** `insets` plus the column of map controls on the right: what framing and labels keep clear of. */
export function reserveControls(insets: Insets = {}): Insets {
  return { ...insets, right: (insets.right ?? 0) + CONTROL_COLUMN_PX };
}

/**
 * The padding to hand `fitBounds` for a map of `width` x `height` pixels with `insets` covered:
 * the covered parts and the map controls, plus a share of what is left, and room above for a pin.
 */
export function fitPadding(width: number, height: number, insets: Insets = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = reserveControls(insets);
  const x = Math.round(Math.max(0, width - left - right) * FIT_PADDING_RATIO);
  const y = Math.round(Math.max(0, height - top - bottom) * FIT_PADDING_RATIO);
  return {
    top: top + Math.max(y, PIN_CLEARANCE_PX),
    bottom: bottom + y,
    left: left + x,
    right: right + x,
  };
}

/** The box around every point of every route: `[[west, south], [east, north]]`. */
export function boundsOfRoutes(routes: RoutePath[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { path } of routes) {
    for (const [lng, lat] of path) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return west > east
    ? null
    : [
        [west, south],
        [east, north],
      ];
}

/** The CSS variables MapLibre's own controls read to sit clear of what covers the map. */
export function insetStyle(insets: Insets = {}): CSSProperties {
  return {
    '--map-inset-top': `${insets.top ?? 0}px`,
    '--map-inset-bottom': `${insets.bottom ?? 0}px`,
  } as CSSProperties;
}
