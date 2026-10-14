import { MISSING, type FrameList, type Heatmap, type HeatmapGrid } from './payload';
import { RISK_LEVELS } from '../risk/palette';
import type { HeatmapLayer } from './layer';
import { colourTable, stepFor, WEATHER_SCALES, type WeatherLayer } from './scales';

/** Pure pixel work for the heatmap, kept apart from the worker that runs it. */

/** The longer side of a frame, in pixels. */
export const TARGET_PX = 384;

/** `[west, south, east, north]` in degrees. */
export type Bounds = [number, number, number, number];

export interface Raster {
  width: number;
  height: number;
  bounds: Bounds;
}

/**
 * The bitmap a grid is drawn into: about `TARGET_PX` on the longer side, one grid cell being
 * as many pixels across as it is down, placed in longitude and latitude. It reaches half a cell
 * beyond the outer points, which is as far as a point's colour extends.
 */
export function rasterFor(grid: HeatmapGrid): Raster {
  const pixelsPerCell = TARGET_PX / Math.max(grid.rows, grid.cols);
  const half = grid.spacing_deg / 2;
  const west = grid.origin_lng - half;
  const south = grid.origin_lat - half;
  return {
    width: Math.max(1, Math.round(grid.cols * pixelsPerCell)),
    height: Math.max(1, Math.round(grid.rows * pixelsPerCell)),
    bounds: [
      west,
      south,
      west + grid.cols * grid.spacing_deg,
      south + grid.rows * grid.spacing_deg,
    ],
  };
}

/**
 * Where each pixel sits among the four grid points around it. It depends on the grid alone,
 * so it is worked out once and shared by all 49 frames.
 */
interface Sampling {
  /** Index into the frame's dense grid of each pixel's four corners (south west, south east,
   * north west, north east); a corner outside the grid points at the empty last slot. */
  corners: [Int32Array, Int32Array, Int32Array, Int32Array];
  /** The bilinear weight of each corner. */
  weights: [Float32Array, Float32Array, Float32Array, Float32Array];
}

function samplingFor(grid: HeatmapGrid, { width, height }: Raster): Sampling {
  const count = width * height;
  const empty = grid.rows * grid.cols;
  const corners = [0, 1, 2, 3].map(() => new Int32Array(count)) as Sampling['corners'];
  const weights = [0, 1, 2, 3].map(() => new Float32Array(count)) as Sampling['weights'];
  const slot = (row: number, col: number) =>
    row < 0 || row >= grid.rows || col < 0 || col >= grid.cols ? empty : row * grid.cols + col;

  for (let py = 0; py < height; py++) {
    // Position among the points, where point k is at k and its cell spans k ± 0.5. Image row
    // 0 is the north edge.
    const y = grid.rows - 0.5 - ((py + 0.5) * grid.rows) / height;
    const row = Math.floor(y);
    const fy = y - row;
    for (let px = 0; px < width; px++) {
      const x = -0.5 + ((px + 0.5) * grid.cols) / width;
      const col = Math.floor(x);
      const fx = x - col;
      const p = py * width + px;
      corners[0][p] = slot(row, col);
      corners[1][p] = slot(row, col + 1);
      corners[2][p] = slot(row + 1, col);
      corners[3][p] = slot(row + 1, col + 1);
      weights[0][p] = (1 - fx) * (1 - fy);
      weights[1][p] = fx * (1 - fy);
      weights[2][p] = (1 - fx) * fy;
      weights[3][p] = fx * fy;
    }
  }
  return { corners, weights };
}

export interface Frames extends Raster {
  /** One RGBA image per hour, top row first (north), `width * height * 4` bytes each. */
  frames: Uint8ClampedArray[];
}

/** The palette's colour of risk levels 0 (Low) to 4 (No Travel), as `[r, g, b]`. */
const LEVEL_COLOURS: [number, number, number][] = RISK_LEVELS.slice(0, 5).map(({ color }) => {
  const value = parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
});

const TOP_LEVEL = LEVEL_COLOURS.length - 1;

/**
 * One image per hour of the risk heatmap.
 *
 * Values are interpolated, never colours. A pixel's risk comes from the four points around it,
 * counting only those that have data. For each level L from the top, the share of that weight
 * on points at L or worse is interpolated, and the pixel takes the highest level where that
 * share is at least half. Where neighbouring levels differ by one this is a threshold on the
 * interpolated score, with a smooth contour between bands. Where they differ by more, such as
 * Low beside Severe, every threshold between them flips at the same place, so no Moderate or
 * High fringe appears that no point has. Colours come from the palette, so the edge between
 * two bands is crisp and no category colour is ever blended into another.
 *
 * A pixel is drawn only where at least half its weight is on points with data: outside the
 * corridor, and at No data, it stays transparent. A transparent pixel near the data still
 * carries the colour it would have, so the GPU's smoothing of the edge doesn't darken it.
 */
export function buildRiskFrames(
  heatmap: Pick<Heatmap, 'grid' | 'indices'> & { frames: Pick<Heatmap['frames'], 'risk'> },
): Frames {
  const { grid, indices } = heatmap;
  const raster = rasterFor(grid);
  const { corners, weights } = samplingFor(grid, raster);
  const [c0, c1, c2, c3] = corners;
  const [w0, w1, w2, w3] = weights;
  const pixels = raster.width * raster.height;
  const dense = new Int8Array(grid.rows * grid.cols + 1);

  const frames = heatmap.frames.risk.map((values) => {
    dense.fill(MISSING);
    for (let i = 0; i < indices.length; i++) dense[indices[i]] = values[i];

    const image = new Uint8ClampedArray(pixels * 4);
    for (let p = 0; p < pixels; p++) {
      const v0 = dense[c0[p]];
      const v1 = dense[c1[p]];
      const v2 = dense[c2[p]];
      const v3 = dense[c3[p]];
      const a0 = v0 >= 0 ? w0[p] : 0;
      const a1 = v1 >= 0 ? w1[p] : 0;
      const a2 = v2 >= 0 ? w2[p] : 0;
      const a3 = v3 >= 0 ? w3[p] : 0;
      const coverage = a0 + a1 + a2 + a3;
      if (coverage <= 0) continue;

      let level = 0;
      for (let l = TOP_LEVEL; l > 0; l--) {
        const share =
          (v0 >= l ? a0 : 0) + (v1 >= l ? a1 : 0) + (v2 >= l ? a2 : 0) + (v3 >= l ? a3 : 0);
        if (share * 2 >= coverage) {
          level = l;
          break;
        }
      }
      const [r, g, b] = LEVEL_COLOURS[level];
      const offset = p * 4;
      image[offset] = r;
      image[offset + 1] = g;
      image[offset + 2] = b;
      image[offset + 3] = coverage >= 0.5 ? 255 : 0;
    }
    return image;
  });

  return { ...raster, frames };
}

/**
 * One image per hour of a raw weather layer, coloured from its fixed scale.
 *
 * The values are interpolated bilinearly between the points that have data, then coloured, so
 * the field is smooth. Anything above the scale's top takes the top colour. As with risk, a
 * pixel is drawn only where at least half its weight is on points with data.
 */
export function buildScalarFrames<L extends WeatherLayer>(
  heatmap: Pick<Heatmap, 'grid' | 'indices' | 'scales'> & { frames: Record<L, FrameList> },
  layer: L,
): Frames {
  const { grid, indices } = heatmap;
  const { max } = WEATHER_SCALES[layer];
  // The payload's integers are `scales[layer]` to the unit.
  const toFraction = 1 / (heatmap.scales[layer] * max);
  const colours = colourTable(WEATHER_SCALES[layer]);
  const raster = rasterFor(grid);
  const { corners, weights } = samplingFor(grid, raster);
  const [c0, c1, c2, c3] = corners;
  const [w0, w1, w2, w3] = weights;
  const pixels = raster.width * raster.height;
  const dense = new Int32Array(grid.rows * grid.cols + 1);

  const frames = heatmap.frames[layer].map((values) => {
    dense.fill(MISSING);
    for (let i = 0; i < indices.length; i++) dense[indices[i]] = values[i];

    const image = new Uint8ClampedArray(pixels * 4);
    for (let p = 0; p < pixels; p++) {
      const v0 = dense[c0[p]];
      const v1 = dense[c1[p]];
      const v2 = dense[c2[p]];
      const v3 = dense[c3[p]];
      const a0 = v0 >= 0 ? w0[p] : 0;
      const a1 = v1 >= 0 ? w1[p] : 0;
      const a2 = v2 >= 0 ? w2[p] : 0;
      const a3 = v3 >= 0 ? w3[p] : 0;
      const coverage = a0 + a1 + a2 + a3;
      if (coverage <= 0) continue;

      const value = (a0 * v0 + a1 * v1 + a2 * v2 + a3 * v3) / coverage;
      const [r, g, b] = colours[stepFor(value * toFraction)];
      const offset = p * 4;
      image[offset] = r;
      image[offset + 1] = g;
      image[offset + 2] = b;
      image[offset + 3] = coverage >= 0.5 ? 255 : 0;
    }
    return image;
  });

  return { ...raster, frames };
}

/** What the worker is asked for: one layer's frames, with what it needs to build them. */
export interface FrameRequest {
  layer: HeatmapLayer;
  grid: HeatmapGrid;
  indices: number[];
  scales: Heatmap['scales'];
  /** The layer's list per hour, as in the payload. */
  values: FrameList;
}

/** The frames of whichever layer is asked for. */
export function buildFrames({ layer, grid, indices, scales, values }: FrameRequest): Frames {
  if (layer === 'risk') return buildRiskFrames({ grid, indices, frames: { risk: values } });
  // Only the requested layer's list is sent; it is the only one the builder reads.
  const frames = { [layer]: values } as Record<WeatherLayer, FrameList>;
  return buildScalarFrames({ grid, indices, scales, frames }, layer);
}
