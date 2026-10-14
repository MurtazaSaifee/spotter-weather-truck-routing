import { useQuery } from '@tanstack/react-query';
import { apiPost } from './client';

/** The body of POST /api/heatmap: exactly the routes on screen. */
export interface HeatmapRequest {
  /** The displayed routes' encoded polylines, as the plan returned them. At most three. */
  geometries: string[];
  /** ISO-8601 with the UTC offset: the frames run from here to 48 hours later. */
  departure: string;
  /** Cargo weight in whole pounds. */
  load_weight_lb: number;
}

/** A regular grid of weather points, row 0 the southernmost. */
export interface HeatmapGrid {
  origin_lat: number;
  origin_lng: number;
  /** Degrees between neighbouring points, both ways. */
  spacing_deg: number;
  rows: number;
  cols: number;
}

/** A hole in the data: no forecast at that point, or none for that variable. */
export const MISSING = -1;

/** One list per hour, one whole number per corridor point (see `Heatmap.indices`). */
export type FrameList = number[][];

/** The forecast and its risk for the 49 hours after departure, over the routes' corridor. */
export interface Heatmap {
  grid: HeatmapGrid;
  /** The corridor's points as `row * cols + col`, ascending. */
  indices: number[];
  /** ISO-8601, one per frame: the departure and every hour to 48 h later. */
  timestamps: string[];
  /** What one unit of each variable's integers is worth. */
  scales: { wind: number; rain: number; snow: number };
  frames: {
    /** 0 Low, 1 Moderate, 2 High, 3 Severe, 4 No Travel; `MISSING` is No data. */
    risk: FrameList;
    /** Tenths of a mile per hour. */
    wind: FrameList;
    /** Thousandths of an inch per hour. */
    rain: FrameList;
    /** Thousandths of an inch per hour. */
    snow: FrameList;
  };
}

/**
 * The heatmap over `request`'s routes, fetched once. Scrubbing the forecast slider happens on
 * the client, so it never asks again. The same routes, departure and load are one query, which
 * is why planning the same trip with another interval keeps the heatmap, and a null request
 * (no plan on screen) holds nothing.
 */
export function useHeatmap(request: HeatmapRequest | null) {
  return useQuery({
    queryKey: ['heatmap', request?.geometries, request?.departure, request?.load_weight_lb],
    queryFn: ({ signal }) => apiPost<Heatmap>('/api/heatmap', request, { signal }),
    enabled: request !== null,
    // The server's forecast is cached for an hour; a few minutes is as fresh as it gets.
    staleTime: 5 * 60_000,
    retry: false,
  });
}
