import type { PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Checkpoint, PlannedRoute } from '../api/plan';
import type { LngLat } from './polyline';
import { riskStyle } from '../risk/palette';
import { rgb } from './colour';

/** One checkpoint, ready to draw and to describe when the driver points at it. */
export interface CheckpointDot {
  routeId: string;
  routeLabel: string;
  checkpoint: Checkpoint;
  position: LngLat;
}

/**
 * How big a dot is: its radius on the ground, held between two pixel sizes. On the ground, it
 * grows with the zoom on the GPU, with no redraw by React. The floor keeps it visible at the
 * zoom where the whole trip fits, where it is small enough to leave the heatmap readable; the
 * ceiling stops it swallowing the road once the driver is zoomed in.
 */
export interface DotSize {
  meters: number;
  minPx: number;
  maxPx: number;
}

export const SELECTED_DOT: DotSize = { meters: 1600, minPx: 3.5, maxPx: 8 };
export const OTHER_DOT: DotSize = { meters: 1000, minPx: 2.5, maxPx: 5.5 };
const OUTLINE_PX = 1.5;

// Metres per pixel at zoom 0 on the equator, for the 512 px tiles of MapLibre and deck.gl.
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.517;

/** The radius a dot is drawn at, in pixels, at a zoom and latitude. */
export function dotRadiusPx({ meters, minPx, maxPx }: DotSize, zoom: number, latitude: number) {
  const metersPerPixel =
    (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return Math.min(maxPx, Math.max(minPx, meters / metersPerPixel));
}

const riskColor = ({ risk }: Checkpoint) => rgb(riskStyle(risk.level).color);

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
}

/** Dots on the routes, coloured by risk level: the selected route's on top and a little larger. */
export function createCheckpointLayers({ dots, selectedRouteId }: CheckpointLayerOptions) {
  const layer = (id: string, data: CheckpointDot[], size: DotSize) =>
    new ScatterplotLayer<CheckpointDot>({
      id,
      data,
      getPosition: (dot) => dot.position,
      getFillColor: (dot) => riskColor(dot.checkpoint),
      getLineColor: [255, 255, 255],
      getRadius: size.meters,
      radiusUnits: 'meters',
      radiusMinPixels: size.minPx,
      radiusMaxPixels: size.maxPx,
      stroked: true,
      getLineWidth: OUTLINE_PX,
      lineWidthUnits: 'pixels',
      pickable: true,
    });

  return [
    layer(
      OTHER_LAYER_ID,
      dots.filter((dot) => dot.routeId !== selectedRouteId),
      OTHER_DOT,
    ),
    layer(
      SELECTED_LAYER_ID,
      dots.filter((dot) => dot.routeId === selectedRouteId),
      SELECTED_DOT,
    ),
  ];
}

/**
 * The dot nearest `point` (pixels in the map's container) and within `reach` pixels of it, or
 * null. A dot a few pixels across is too small to tap exactly, so on a touch screen a tap picks
 * the nearest dot in reach of the finger instead.
 */
export function nearestDot(
  dots: CheckpointDot[],
  point: [number, number],
  project: (position: LngLat) => [number, number],
  reach: number,
): CheckpointDot | null {
  let nearest: CheckpointDot | null = null;
  let nearestDistance = reach;
  for (const dot of dots) {
    const [x, y] = project(dot.position);
    const distance = Math.hypot(x - point[0], y - point[1]);
    if (distance <= nearestDistance) {
      nearest = dot;
      nearestDistance = distance;
    }
  }
  return nearest;
}
