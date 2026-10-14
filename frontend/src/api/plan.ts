import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPost } from './client';
import type { Place } from './places';
import { type RateLimitWait, retryOnceAfterRateLimit } from './rateLimit';

/** The body of POST /api/plan. */
export interface PlanRequest {
  /** A suggested place goes as it is; the server works out the zone itself. */
  origin: Place;
  destination: Place;
  /** ISO-8601 with the UTC offset of the origin's zone, e.g. `2026-10-15T08:00:00-05:00`. */
  departure: string;
  /** Cargo weight in whole pounds. */
  load_weight_lb: number;
  /** Miles between checkpoints. Left out, the server picks one from the trip's length. */
  interval_miles?: SamplingInterval;
}

/** The sampling intervals the server accepts. */
export const SAMPLING_INTERVALS = [10, 25, 50] as const;
export type SamplingInterval = (typeof SAMPLING_INTERVALS)[number];

/** The forecast for the hour a truck is at a checkpoint. */
export interface CheckpointWeather {
  /** Sustained wind at 10 m, in mph. */
  wind_mph: number;
  /** Strongest gust, in mph; null when the forecast has none. */
  gust_mph: number | null;
  /** Rain plus showers, in inches per hour. */
  rain_in_hr: number;
  /** Snowfall, in inches of snow per hour. */
  snow_in_hr: number;
}

/** A risk level's code. `no_data` is a checkpoint without a forecast: never Low. */
export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe' | 'no_travel';
export type CheckpointRiskLevel = RiskLevel | 'no_data';
export type ConditionName = 'wind' | 'rain' | 'snow';

/** How risky a checkpoint's forecast is for the load. */
export interface CheckpointRisk {
  /** The worst of wind (after the load rules), rain and snow. */
  level: CheckpointRiskLevel;
  /** Level 0 to 4, plus 0.5 when conditions combine; null for No data. */
  score: number | null;
  /** Each condition's own level; null for one the forecast lacks. */
  conditions: Record<ConditionName, RiskLevel | null>;
  /** The condition(s) at the overall level; empty for Low and No data. */
  driving: ConditionName[];
  /** When two or more conditions are Moderate or worse, which; otherwise empty. */
  combined: ConditionName[];
  /** Gusts alone would be High or worse, above the sustained wind. Informational. */
  gust_warning: { gust_mph: number; level: RiskLevel } | null;
  /** The load rules put the wind in a higher band than the wind table. */
  wind_raised_by_load: boolean;
}

/** A sampled point on a route. */
export interface Checkpoint {
  /** Miles from the origin along the route. */
  mile: number;
  lat: number;
  lng: number;
  /** When the truck gets here: ISO-8601 in the origin's zone. */
  eta: string;
  /** Miles of road this checkpoint stands for; a route's checkpoints add up to its length. */
  covered_miles: number;
  /** The forecast for the hour the truck is here; null means No data. */
  weather: CheckpointWeather | null;
  risk: CheckpointRisk;
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
  /** Seconds after departure at each vertex of `geometry`. */
  elapsed_seconds: number[];
  /** From the origin to the destination. */
  checkpoints: Checkpoint[];
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
  /** Miles between checkpoints, the same on every route. */
  interval_miles: SamplingInterval;
  /** True when the server chose the interval from the trip's length. */
  interval_automatic: boolean;
  routes: PlannedRoute[];
  notices: Notice[];
}

/**
 * Plans a trip when `mutate` is called: routes, with their times in the origin's zone. When a
 * rate limit turns the request down for a short while, it waits and asks once more, and
 * `rateLimitWait` holds the countdown meanwhile (the mutation stays pending).
 */
export function usePlanTrip() {
  const [rateLimitWait, setRateLimitWait] = useState<RateLimitWait | null>(null);
  const mutation = useMutation({
    mutationFn: (request: PlanRequest) =>
      retryOnceAfterRateLimit(() => apiPost<Plan>('/api/plan', request), setRateLimitWait),
  });
  return { ...mutation, rateLimitWait };
}
