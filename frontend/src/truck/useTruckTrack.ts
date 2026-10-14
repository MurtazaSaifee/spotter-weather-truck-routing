import { useMemo } from 'react';
import type { PlannedRoute } from '../api/plan';
import { decodePolyline } from '../map/polyline';
import { createTruckTrack, type TruckTrack } from './truckTrack';

/** The route's line paired with its times, decoded once per route. Null while there is no route. */
export function useTruckTrack(route: PlannedRoute | null): TruckTrack | null {
  return useMemo(
    () =>
      route
        ? createTruckTrack(
            decodePolyline(route.geometry),
            route.elapsed_seconds,
            route.distance_miles,
          )
        : null,
    [route],
  );
}
