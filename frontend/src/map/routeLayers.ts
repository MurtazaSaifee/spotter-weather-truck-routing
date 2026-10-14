import type { PickingInfo } from '@deck.gl/core';
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
  onSelectRoute: (id: string) => void;
  /** `#rrggbb` colours: the selected route stands out from the others. */
  selectedColor: string;
  otherColor: string;
}

const SELECTED_WIDTH_PX = 7;
const OTHER_WIDTH_PX = 5;
// Routes are thin lines, so let a click land a few pixels off one.
export const ROUTE_PICKING_RADIUS_PX = 8;

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The routes as deck.gl layers: every route in one layer and the selected one in
 * a second, so it is drawn thicker and on top. Clicking any route selects it.
 */
export function createRouteLayers({
  paths,
  selectedRouteId,
  onSelectRoute,
  selectedColor,
  otherColor,
}: RouteLayerOptions) {
  const layer = (id: string, data: RoutePath[], color: string, width: number) =>
    new PathLayer<RoutePath>({
      id,
      data,
      getPath: (route) => route.path,
      getColor: rgb(color),
      getWidth: width,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      pickable: true,
      onClick: ({ object }: PickingInfo<RoutePath>) => {
        if (object) onSelectRoute(object.id);
      },
    });

  return [
    layer(
      'routes',
      paths.filter((route) => route.id !== selectedRouteId),
      otherColor,
      OTHER_WIDTH_PX,
    ),
    layer(
      'selected-route',
      paths.filter((route) => route.id === selectedRouteId),
      selectedColor,
      SELECTED_WIDTH_PX,
    ),
  ];
}
