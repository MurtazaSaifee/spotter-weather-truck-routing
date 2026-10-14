import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { PlannedRoute } from '../api/plan';
import type { Insets } from './framing';
import type { LayerStore } from './layerStore';
import type { LngLat } from './polyline';
import { ROLE_STYLES, routeRole, type RoutePath } from './routeLayers';
import {
  createRouteLabelLayer,
  labelSize,
  placeLabels,
  routeLabelText,
  type RouteLabel,
} from './routeLabels';

// Below this width a label carries only its name, time and status: three of the longer ones
// would not leave room for the map itself.
const FULL_LABEL_MIN_WIDTH_PX = 560;

interface LabelPlacementProps {
  routes: PlannedRoute[];
  paths: RoutePath[];
  /** Route ids to the names the cards use (`Route 1`). */
  names: Record<string, string>;
  selectedRouteId: string | null;
  recommendedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  /** Parts of the map covered by the layout; labels stay clear of them. */
  insets?: Insets;
  /** Where the label layer goes; the map's overlay draws it above the routes and dots. */
  layers: LayerStore;
}

/**
 * Keeps each route's label where it can be read: on a stretch where its route is clear of the
 * others, inside the map, and not over another label. Placement follows the map's own size and
 * view, so it is redone when the map stops moving or is resized, not on every frame of a pan;
 * a label that is still well placed stays where it is. Must sit inside a `Map`; renders nothing.
 */
export function LabelPlacement({
  routes,
  paths,
  names,
  selectedRouteId,
  recommendedRouteId,
  onSelectRoute,
  insets,
  layers,
}: LabelPlacementProps) {
  const { current: map } = useMap();
  // Where the labels were last put, so that they stay put while that is still a good place.
  const previous = useRef<Record<string, LngLat>>({});
  // The insets arrive as an object that changes identity each render; its values are what count.
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets ?? {};

  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const place = () => {
      const { clientWidth: width, clientHeight: height } = raw.getContainer();
      const detail = width >= FULL_LABEL_MIN_WIDTH_PX ? 'full' : 'brief';
      const texts = new Map(
        routes.map((route) => [
          route.id,
          routeLabelText(route, names[route.id], {
            recommended: route.id === recommendedRouteId,
            detail,
          }),
        ]),
      );
      const styleOf = (route: PlannedRoute) =>
        ROLE_STYLES[routeRole(route.id, route.blocked, { selectedRouteId, recommendedRouteId })];

      const anchors = placeLabels(
        routes.flatMap((route) => {
          const path = paths.find(({ id }) => id === route.id)?.path;
          return path
            ? [{ id: route.id, path, size: labelSize(texts.get(route.id)!), priority: styleOf(route).labelPriority }]
            : [];
        }),
        {
          project: (point) => {
            const { x, y } = raw.project(point);
            return [x, y];
          },
          width,
          height,
          padding: { top, right, bottom, left },
        },
        previous.current,
      );
      previous.current = anchors;

      const labels: RouteLabel[] = routes.flatMap((route) =>
        anchors[route.id]
          ? [
              {
                routeId: route.id,
                text: texts.get(route.id)!,
                position: anchors[route.id],
                tone: styleOf(route).tone,
              },
            ]
          : [],
      );
      layers.set([createRouteLabelLayer(labels, onSelectRoute)]);
    };

    place();
    raw.on('moveend', place);
    raw.on('resize', place);
    return () => {
      raw.off('moveend', place);
      raw.off('resize', place);
      layers.set([]);
    };
  }, [
    map,
    routes,
    paths,
    names,
    selectedRouteId,
    recommendedRouteId,
    onSelectRoute,
    top,
    right,
    bottom,
    left,
    layers,
  ]);

  return null;
}
