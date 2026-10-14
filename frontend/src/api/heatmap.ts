import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Heatmap } from '../heatmap/payload';
import { apiPost } from './client';
import { type RateLimitWait, retryOnceAfterRateLimit } from './rateLimit';

/** The body of POST /api/heatmap: exactly the routes on screen. */
export interface HeatmapRequest {
  /** The displayed routes' encoded polylines, as the plan returned them. At most three. */
  geometries: string[];
  /** ISO-8601 with the UTC offset: the frames run from here to 48 hours later. */
  departure: string;
  /** Cargo weight in whole pounds. */
  load_weight_lb: number;
}

/**
 * The heatmap over `request`'s routes, fetched once. Scrubbing the forecast slider happens on
 * the client, so it never asks again. The same routes, departure and load are one query, which
 * is why planning the same trip with another interval keeps the heatmap, and a null request
 * (no plan on screen) holds nothing. When a rate limit turns the request down for a short
 * while, it waits and asks once more, and `rateLimitWait` holds the countdown meanwhile.
 */
export function useHeatmap(request: HeatmapRequest | null) {
  const [rateLimitWait, setRateLimitWait] = useState<RateLimitWait | null>(null);
  const query = useQuery({
    queryKey: ['heatmap', request?.geometries, request?.departure, request?.load_weight_lb],
    queryFn: ({ signal }) =>
      retryOnceAfterRateLimit(
        () => apiPost<Heatmap>('/api/heatmap', request, { signal }),
        setRateLimitWait,
        signal,
      ),
    enabled: request !== null,
    // The server's forecast is cached for an hour; a few minutes is as fresh as it gets.
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { ...query, rateLimitWait };
}
