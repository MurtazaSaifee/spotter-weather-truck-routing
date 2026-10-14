import { useMutation } from '@tanstack/react-query';
import { apiPost } from './client';
import type { Place } from './places';

/** The body of POST /api/plan. */
export interface PlanRequest {
  /** A suggested place goes as it is; the server works out the zone itself. */
  origin: Place;
  destination: Place;
  /** ISO-8601 with the UTC offset of the origin's zone, e.g. `2026-10-15T08:00:00-05:00`. */
  departure: string;
  /** Cargo weight in whole pounds. */
  load_weight_lb: number;
}

export interface PlannedRoute {
  /** Stable within a plan, e.g. `route-1`. */
  id: string;
  distance_miles: number;
  /** Travel time including predicted traffic and truck speeds. */
  duration_seconds: number;
  /** ISO-8601 in the origin's zone. */
  arrival: string;
  /** Google encoded polyline (precision 5), simplified to about 100 m. */
  geometry: string;
}

/** A plan-level message for the driver. */
export interface Notice {
  code: string;
  message: string;
}

export interface Plan {
  /** IANA zone at the origin: every time in the plan is shown in it. */
  origin_time_zone: string;
  departure: string;
  routes: PlannedRoute[];
  notices: Notice[];
}

/** Plans a trip when `mutate` is called: routes, with their times in the origin's zone. */
export function usePlanTrip() {
  return useMutation({
    mutationFn: (request: PlanRequest) => apiPost<Plan>('/api/plan', request),
  });
}
