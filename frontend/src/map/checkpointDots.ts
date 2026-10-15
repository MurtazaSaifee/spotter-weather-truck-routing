import type { PickingInfo } from '@deck.gl/core';
import type { Checkpoint, PlannedRoute } from '../api/plan';
import { routeLabels } from '../trip/ranking';
import type { LngLat } from './polyline';

// The checkpoint dots as data, and how a pointer finds them. Kept apart from checkpointLayers.ts,
// which draws them with deck.gl: TripMap reads these on the way in, before deck.gl is needed.

/** One checkpoint, ready to draw and to describe when the driver points at it. */
export interface CheckpointDot {
  routeId: string;
  routeLabel: string;
  checkpoint: Checkpoint;
  position: LngLat;
}

/** The ids of the two checkpoint layers, which `dotAt` reads from a picking result. */
export const SELECTED_LAYER_ID = 'selected-checkpoints';
export const OTHER_LAYER_ID = 'checkpoints';

/** The dots of every route, labelled `Route 1`, `Route 2`… like the route cards. */
export function checkpointDots(routes: PlannedRoute[]): CheckpointDot[] {
  const labels = routeLabels(routes);
  return routes.flatMap((route) =>
    route.checkpoints.map((checkpoint) => ({
      routeId: route.id,
      routeLabel: labels[route.id],
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
