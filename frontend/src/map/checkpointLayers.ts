import type { PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Checkpoint, PlannedRoute } from '../api/plan';
import type { LngLat } from './polyline';
import { rgb } from './routeLayers';

/** One checkpoint, ready to draw and to describe when the driver points at it. */
export interface CheckpointDot {
  routeId: string;
  routeLabel: string;
  checkpoint: Checkpoint;
  position: LngLat;
}

const SELECTED_RADIUS_PX = 6;
const OTHER_RADIUS_PX = 4.5;
const OUTLINE_PX = 2;

const SELECTED_LAYER_ID = 'selected-checkpoints';
const OTHER_LAYER_ID = 'checkpoints';

/** The dots of every route, labelled `Route 1`, `Route 2`… like the route cards. */
export function checkpointDots(routes: PlannedRoute[]): CheckpointDot[] {
  return routes.flatMap((route, index) =>
    route.checkpoints.map((checkpoint) => ({
      routeId: route.id,
      routeLabel: `Route ${index + 1}`,
      checkpoint,
      position: [checkpoint.lng, checkpoint.lat] as LngLat,
    })),
  );
}

/** The dot a picking result is about, if it is one of the checkpoint layers'. */
export function dotAt(info: PickingInfo): CheckpointDot | null {
  const id = info.layer?.id;
  return id === SELECTED_LAYER_ID || id === OTHER_LAYER_ID ? (info.object as CheckpointDot) : null;
}

interface CheckpointLayerOptions {
  dots: CheckpointDot[];
  selectedRouteId: string | null;
  /** `#rrggbb` colours, matching the route lines. */
  selectedColor: string;
  otherColor: string;
}

/** Dots on the routes: the selected route's on top and a little larger. */
export function createCheckpointLayers({
  dots,
  selectedRouteId,
  selectedColor,
  otherColor,
}: CheckpointLayerOptions) {
  const layer = (id: string, data: CheckpointDot[], color: string, radius: number) =>
    new ScatterplotLayer<CheckpointDot>({
      id,
      data,
      getPosition: (dot) => dot.position,
      getFillColor: rgb(color),
      getLineColor: [255, 255, 255],
      getRadius: radius,
      radiusUnits: 'pixels',
      stroked: true,
      getLineWidth: OUTLINE_PX,
      lineWidthUnits: 'pixels',
      pickable: true,
    });

  return [
    layer(
      OTHER_LAYER_ID,
      dots.filter((dot) => dot.routeId !== selectedRouteId),
      otherColor,
      OTHER_RADIUS_PX,
    ),
    layer(
      SELECTED_LAYER_ID,
      dots.filter((dot) => dot.routeId === selectedRouteId),
      selectedColor,
      SELECTED_RADIUS_PX,
    ),
  ];
}
