import type { PickingInfo } from '@deck.gl/core';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer } from '@deck.gl/layers';
import type { LngLat } from './polyline';

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
export const OTHER_WIDTH_PX = 5;
// Dash and gap lengths, in line widths.
const DASH: [number, number] = [3, 2];
// Routes are thin lines, so let a click land a few pixels off one.
export const ROUTE_PICKING_RADIUS_PX = 8;

export function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The routes as deck.gl layers, drawn in this order so that what matters is on top: the other
 * routes, then the recommended one (thicker), then the selected one. Blocked routes sit in a
 * dashed layer of their own at each level. Clicking any route selects it.
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
  const widthOf = ({ id }: RoutePath) =>
    id === recommendedRouteId
      ? RECOMMENDED_WIDTH_PX
      : id === selectedRouteId
        ? SELECTED_WIDTH_PX
        : OTHER_WIDTH_PX;
  const colorOf = ({ id }: RoutePath) =>
    rgb(id === selectedRouteId ? selectedColor : id === recommendedRouteId ? recommendedColor : otherColor);

  const layer = (id: string, data: RoutePath[], dashed: boolean) =>
    new PathLayer<RoutePath, PathStyleExtensionProps<RoutePath>>({
      id,
      data,
      getPath: (route) => route.path,
      getColor: colorOf,
      getWidth: widthOf,
      widthUnits: 'pixels',
      capRounded: !dashed,
      jointRounded: true,
      pickable: true,
      onClick: ({ object }: PickingInfo<RoutePath>) => {
        if (object) onSelectRoute(object.id);
      },
      ...(dashed && {
        extensions: [new PathStyleExtension({ dash: true })],
        getDashArray: DASH,
        dashJustified: true,
      }),
    });

  const tier = (matches: (route: RoutePath) => boolean) => ({
    solid: paths.filter((route) => matches(route) && !blockedRouteIds.has(route.id)),
    dashed: paths.filter((route) => matches(route) && blockedRouteIds.has(route.id)),
  });
  const isSelected = (route: RoutePath) => route.id === selectedRouteId;
  const isRecommended = (route: RoutePath) =>
    route.id === recommendedRouteId && !isSelected(route);
  const others = tier((route) => !isSelected(route) && !isRecommended(route));
  const recommended = tier(isRecommended);
  const selected = tier(isSelected);

  return [
    layer('routes', others.solid, false),
    layer('routes-blocked', others.dashed, true),
    layer('recommended-route', recommended.solid, false),
    layer('selected-route', selected.solid, false),
    layer('selected-route-blocked', selected.dashed, true),
  ];
}
