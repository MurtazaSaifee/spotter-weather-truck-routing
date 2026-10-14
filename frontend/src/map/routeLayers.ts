import type { PickingInfo } from '@deck.gl/core';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer } from '@deck.gl/layers';
import { rgb } from './colour';
import type { LngLat } from './polyline';
import type { LabelTone } from './routeLabels';

/** A route's geometry, ready to draw. */
export interface RoutePath {
  id: string;
  path: LngLat[];
}

interface RouteLayerOptions {
  paths: RoutePath[];
  selectedRouteId: string | null;
  /** The recommended route is drawn thicker and above the others; null when none is. */
  recommendedRouteId: string | null;
  /** Blocked routes are drawn dashed. */
  blockedRouteIds: ReadonlySet<string>;
  onSelectRoute: (id: string) => void;
  /** `#rrggbb` colours: the selected route stands out, the recommended one is a darker shade. */
  selectedColor: string;
  recommendedColor: string;
  otherColor: string;
}

export const RECOMMENDED_WIDTH_PX = 9;
export const SELECTED_WIDTH_PX = 7;
export const OTHER_WIDTH_PX = 4;
// The white band the selected route is set in: this much wider than the route, so that it
// shows a pixel or two at each side.
export const CASING_EXTRA_PX = 5;
// Once a route is selected the rest fall back, so the choice reads at a glance.
const DIMMED_ALPHA = 170;
// Dash and gap lengths, in line widths.
const DASH: [number, number] = [3, 2];
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

const CASING_COLOR: [number, number, number] = [255, 255, 255];

/**
 * What a route is on the map. A route is the selected one, the recommended one, both, a blocked
 * one or just another; the first that applies wins.
 */
export type RouteRole = 'selectedRecommended' | 'selected' | 'recommended' | 'blocked' | 'other';

export interface RouteSelection {
  selectedRouteId: string | null;
  recommendedRouteId: string | null;
}

export function routeRole(
  id: string,
  blocked: boolean,
  { selectedRouteId, recommendedRouteId }: RouteSelection,
): RouteRole {
  const selected = id === selectedRouteId;
  const recommended = id === recommendedRouteId;
  if (selected && recommended) return 'selectedRecommended';
  if (selected) return 'selected';
  if (recommended) return 'recommended';
  return blocked ? 'blocked' : 'other';
}

type ColourKey = 'selected' | 'recommended' | 'other';

interface RoleStyle {
  /** The line's width. A recommended route stays thick when it is selected too. */
  width: number;
  /** Which of the three colours the line takes. */
  colour: ColourKey;
  /** The drawing group: later groups sit on top of earlier ones. */
  tier: ColourKey;
  /** The label's look on the map. */
  tone: LabelTone;
  /** Labels are placed highest first, so the selected route gets the best spot. */
  labelPriority: number;
}

/** How each role is drawn, in one place: the lines and the labels both read it. */
export const ROLE_STYLES: Record<RouteRole, RoleStyle> = {
  selectedRecommended: {
    width: RECOMMENDED_WIDTH_PX,
    colour: 'selected',
    tier: 'selected',
    tone: 'selected',
    labelPriority: 3,
  },
  selected: {
    width: SELECTED_WIDTH_PX,
    colour: 'selected',
    tier: 'selected',
    tone: 'selected',
    labelPriority: 3,
  },
  recommended: {
    width: RECOMMENDED_WIDTH_PX,
    colour: 'recommended',
    tier: 'recommended',
    tone: 'recommended',
    labelPriority: 2,
  },
  blocked: {
    width: OTHER_WIDTH_PX,
    colour: 'other',
    tier: 'other',
    tone: 'blocked',
    labelPriority: 0,
  },
  other: {
    width: OTHER_WIDTH_PX,
    colour: 'other',
    tier: 'other',
    tone: 'plain',
    labelPriority: 1,
  },
};

/**
 * The routes as deck.gl layers, drawn in this order so that what matters is on top: the other
 * routes (dimmed once one is selected), then the recommended one (thicker), then the selected
 * one in a white casing. Blocked routes sit in a dashed layer of their own at each level.
 * Clicking any route selects it.
 */
export function createRouteLayers({
  paths,
  selectedRouteId,
  recommendedRouteId,
  blockedRouteIds,
  onSelectRoute,
  selectedColor,
  recommendedColor,
  otherColor,
}: RouteLayerOptions) {
  const styleOf = ({ id }: RoutePath) =>
    ROLE_STYLES[
      routeRole(id, blockedRouteIds.has(id), { selectedRouteId, recommendedRouteId })
    ];
  const widthOf = (route: RoutePath) => styleOf(route).width;
  const colors: Record<ColourKey, string> = {
    selected: selectedColor,
    recommended: recommendedColor,
    other: otherColor,
  };
  const colorOf = (route: RoutePath): [number, number, number, number] => {
    const { colour } = styleOf(route);
    const dimmed = colour === 'other' && selectedRouteId !== null;
    return [...rgb(colors[colour]), dimmed ? DIMMED_ALPHA : 255];
  };

  const layer = (id: string, data: RoutePath[], dashed: boolean, casing = false) =>
    new PathLayer<RoutePath, PathStyleExtensionProps<RoutePath>>({
      id,
      data,
      getPath: (route) => route.path,
      getColor: casing ? CASING_COLOR : colorOf,
      getWidth: casing ? (route) => widthOf(route) + CASING_EXTRA_PX : widthOf,
      widthUnits: 'pixels',
      capRounded: !dashed,
      jointRounded: true,
      pickable: !casing,
      onClick: ({ object }: PickingInfo<RoutePath>) => {
        if (object) onSelectRoute(object.id);
      },
      ...(dashed && {
        extensions: [new PathStyleExtension({ dash: true })],
        getDashArray: DASH,
        dashJustified: true,
      }),
    });

  const tier = (name: ColourKey) => {
    const inTier = paths.filter((route) => styleOf(route).tier === name);
    return {
      solid: inTier.filter((route) => !blockedRouteIds.has(route.id)),
      dashed: inTier.filter((route) => blockedRouteIds.has(route.id)),
    };
  };
  const others = tier('other');
  const recommended = tier('recommended');
  const selected = tier('selected');

  return [
    layer('routes', others.solid, false),
    layer('routes-blocked', others.dashed, true),
    layer('recommended-route', recommended.solid, false),
    layer('selected-route-casing', selected.solid, false, true),
    layer('selected-route-dashed-casing', selected.dashed, true, true),
    layer('selected-route', selected.solid, false),
    layer('selected-route-blocked', selected.dashed, true),
  ];
}
