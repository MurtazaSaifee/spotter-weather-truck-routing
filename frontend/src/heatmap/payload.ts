/**
 * The shape of POST /api/heatmap's answer. Types and one constant only, with no imports: the
 * frame-building worker needs these and must not drag the API client, React Query or the rate
 * limiter into its bundle.
 */

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
