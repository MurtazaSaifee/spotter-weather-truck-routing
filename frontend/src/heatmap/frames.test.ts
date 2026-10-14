import { describe, expect, it } from 'vitest';
import { MISSING, type Heatmap } from '../api/heatmap';
import { RISK_LEVELS } from '../risk/palette';
import { buildRiskFrames, buildScalarFrames, rasterFor, type Frames } from './frames';
import { WEATHER_SCALES } from './scales';

const GRID = { origin_lat: 40, origin_lng: -100, spacing_deg: 0.1 };

/** The colour of each risk level 0 to 4, as `r,g,b`. */
const COLOURS = RISK_LEVELS.slice(0, 5).map(({ color }) => {
  const value = parseInt(color.slice(1), 16);
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
});

/** A heatmap whose every hour is `risk` (one row per grid row, south first). */
function heatmapOf(rows: number[][], hours = 1): Pick<Heatmap, 'grid' | 'indices' | 'frames'> {
  const cols = rows[0].length;
  const indices: number[] = [];
  const values: number[] = [];
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== OUTSIDE) {
        indices.push(r * cols + c);
        values.push(value);
      }
    }),
  );
  const same = Array.from({ length: hours }, () => values);
  return {
    grid: { ...GRID, rows: rows.length, cols },
    indices,
    frames: { risk: same, wind: same, rain: same, snow: same },
  };
}

/** A grid cell that is not part of the corridor. */
const OUTSIDE = -99;

/** The pixel at (x, y), top row first, as `r,g,b` or `clear`. */
function pixel(frames: Frames, hour: number, x: number, y: number): string {
  const offset = (y * frames.width + x) * 4;
  const data = frames.frames[hour];
  return data[offset + 3] === 0
    ? 'clear'
    : `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
}

/** The pixel over grid point (row, col): the centre of its cell. */
function pixelOver(frames: Frames, grid: Heatmap['grid'], hour: number, row: number, col: number) {
  const x = Math.floor(((col + 0.5) * frames.width) / grid.cols);
  const y = Math.floor(((grid.rows - row - 0.5) * frames.height) / grid.rows);
  return pixel(frames, hour, x, y);
}

function distinctColours(frames: Frames, hour = 0): Set<string> {
  const seen = new Set<string>();
  for (let y = 0; y < frames.height; y++) {
    for (let x = 0; x < frames.width; x++) seen.add(pixel(frames, hour, x, y));
  }
  return seen;
}

describe('the raster', () => {
  it('makes the longer side about 384 px and keeps the grid cells square', () => {
    const raster = rasterFor({ ...GRID, rows: 20, cols: 60 });

    expect(raster.width).toBe(384);
    expect(raster.height).toBe(128);
  });

  it('is placed half a cell beyond the outer points, in longitude and latitude', () => {
    const { bounds } = rasterFor({ ...GRID, rows: 20, cols: 60 });

    expect(bounds[0]).toBeCloseTo(-100.05);
    expect(bounds[1]).toBeCloseTo(39.95);
    expect(bounds[2]).toBeCloseTo(-100.05 + 6);
    expect(bounds[3]).toBeCloseTo(39.95 + 2);
  });
});

describe('risk frames', () => {
  it('colours the pixel over each point with that point’s level', () => {
    const heatmap = heatmapOf([
      [0, 1, 2],
      [3, 4, 0],
    ]);

    const frames = buildRiskFrames(heatmap);

    const expected = [
      [0, 1, 2],
      [3, 4, 0],
    ];
    expected.forEach((row, r) =>
      row.forEach((level, c) =>
        expect(pixelOver(frames, heatmap.grid, 0, r, c)).toBe(COLOURS[level]),
      ),
    );
  });

  it('draws only the palette’s colours: the edge between two bands is crisp, never a blend', () => {
    const frames = buildRiskFrames(
      heatmapOf([
        [0, 0, 4, 4],
        [0, 0, 4, 4],
        [2, 2, 3, 3],
      ]),
    );

    const colours = distinctColours(frames);

    colours.delete('clear');
    for (const colour of colours) expect(COLOURS).toContain(colour);
  });

  it('never invents a level between two that touch: Low beside Severe has no Moderate or High', () => {
    const frames = buildRiskFrames(
      heatmapOf([
        [0, 0, 3, 3],
        [0, 0, 3, 3],
        [0, 0, 3, 3],
      ]),
    );

    const colours = distinctColours(frames);

    expect(colours).toContain(COLOURS[0]);
    expect(colours).toContain(COLOURS[3]);
    expect(colours).not.toContain(COLOURS[1]);
    expect(colours).not.toContain(COLOURS[2]);
  });

  it('puts the edge midway between two points, and a tie goes to the higher risk', () => {
    const grid = heatmapOf([[0, 3]]);
    const frames = buildRiskFrames(grid);

    // Two cells across; the edge is at the boundary between them. The pixels just left of it
    // are Low, and from the boundary on are Severe.
    const half = frames.width / 2;
    const y = Math.floor(frames.height / 2);
    expect(pixel(frames, 0, half - 3, y)).toBe(COLOURS[0]);
    expect(pixel(frames, 0, half, y)).toBe(COLOURS[3]);
  });

  it('keeps the middle level where the data has one: Low, Moderate, High in a row', () => {
    const frames = buildRiskFrames(heatmapOf([[0, 1, 2]]));

    expect(distinctColours(frames)).toContain(COLOURS[1]);
  });

  it('leaves everything outside the corridor and every No data point transparent', () => {
    const heatmap = heatmapOf([
      [OUTSIDE, OUTSIDE, OUTSIDE, OUTSIDE, OUTSIDE],
      [OUTSIDE, 0, MISSING, 0, OUTSIDE],
      [OUTSIDE, OUTSIDE, OUTSIDE, OUTSIDE, OUTSIDE],
    ]);
    // The point at the middle has no forecast: it is in the corridor, with the value -1.
    heatmap.indices = [6, 7, 8];
    heatmap.frames.risk = [[0, MISSING, 0]];

    const frames = buildRiskFrames(heatmap);

    expect(pixelOver(frames, heatmap.grid, 0, 1, 1)).toBe(COLOURS[0]);
    expect(pixelOver(frames, heatmap.grid, 0, 1, 2)).toBe('clear');
    expect(pixelOver(frames, heatmap.grid, 0, 0, 0)).toBe('clear');
    expect(pixelOver(frames, heatmap.grid, 0, 2, 4)).toBe('clear');
    expect(pixel(frames, 0, 0, 0)).toBe('clear');
  });

  it('does not let a point with data bleed far past the corridor', () => {
    const heatmap = heatmapOf([[OUTSIDE, OUTSIDE, 2, OUTSIDE, OUTSIDE]]);

    const frames = buildRiskFrames(heatmap);

    const painted = [...Array(frames.width).keys()].filter(
      (x) => pixel(frames, 0, x, Math.floor(frames.height / 2)) !== 'clear',
    );
    // About one cell wide: half a cell either side of the point.
    const cell = frames.width / 5;
    expect(painted.length).toBeGreaterThan(cell * 0.8);
    expect(painted.length).toBeLessThan(cell * 1.2);
  });

  it('builds a frame for every hour from that hour’s values', () => {
    const heatmap = heatmapOf([[0, 0]], 3);
    heatmap.frames.risk = [[0, 0], [4, 4], [1, 1]];

    const frames = buildRiskFrames(heatmap);

    expect(frames.frames).toHaveLength(3);
    expect([0, 1, 2].map((hour) => pixelOver(frames, heatmap.grid, hour, 0, 0))).toEqual([
      COLOURS[0],
      COLOURS[4],
      COLOURS[1],
    ]);
  });

  it('builds all 49 frames of the largest grid well inside the 500 ms budget', () => {
    // 90 by 90 grid with 500 points scattered diagonally, a worst case for a corridor's shape.
    const rows = 90;
    const cols = 90;
    const indices: number[] = [];
    for (let step = 0; step < 500; step++) {
      const r = Math.floor((step * rows) / 500);
      const c = Math.min(cols - 1, Math.floor((step * cols) / 500) + (step % 3));
      indices.push(r * cols + c);
    }
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    const risk = Array.from({ length: 49 }, (_, hour) =>
      unique.map((_, point) => (point + hour) % 5),
    );
    const heatmap = { grid: { ...GRID, rows, cols }, indices: unique, frames: { risk } };

    const start = performance.now();
    const frames = buildRiskFrames(heatmap);
    const elapsed = performance.now() - start;

    expect(frames.frames).toHaveLength(49);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('weather frames', () => {
  const SCALES = { wind: 10, rain: 1000, snow: 1000 };
  const rgb = (hex: string) => {
    const value = parseInt(hex.slice(1), 16);
    return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
  };

  /** One row of wind values, in tenths of a mile per hour. */
  function windAt(...tenthsOfMph: number[]) {
    const base = heatmapOf([tenthsOfMph]);
    return { ...base, scales: SCALES, frames: { ...base.frames, wind: [tenthsOfMph] } };
  }

  it('paints the bottom of the scale at zero and the top at the scale’s maximum', () => {
    const wind = WEATHER_SCALES.wind;
    const calm = windAt(0, 0);
    const gale = windAt(600, 600);

    const calmFrames = buildScalarFrames(calm, 'wind');
    const galeFrames = buildScalarFrames(gale, 'wind');

    expect(pixelOver(calmFrames, calm.grid, 0, 0, 0)).toBe(rgb(wind.stops[0]));
    expect(pixelOver(galeFrames, gale.grid, 0, 0, 1)).toBe(rgb(wind.stops.at(-1)!));
  });

  it('clamps anything above the top of the scale to the top colour', () => {
    const heatmap = windAt(600, 601, 1500);

    const frames = buildScalarFrames(heatmap, 'wind');

    const top = rgb(WEATHER_SCALES.wind.stops.at(-1)!);
    [0, 1, 2].forEach((c) => expect(pixelOver(frames, heatmap.grid, 0, 0, c)).toBe(top));
  });

  it('puts half the scale on the middle colour, reading the integers through the payload’s scale', () => {
    const base = heatmapOf([[0, 0]]);
    const heatmap = {
      ...base,
      scales: SCALES,
      // 0.6 in/hr and 1.75 in/hr: half of 1.2 and of 3.5.
      frames: { ...base.frames, rain: [[600, 600]], snow: [[1750, 1750]] },
    };

    const rain = buildScalarFrames(heatmap, 'rain');
    const snow = buildScalarFrames(heatmap, 'snow');

    expect(pixelOver(rain, heatmap.grid, 0, 0, 0)).toBe(rgb(WEATHER_SCALES.rain.stops[2]));
    expect(pixelOver(snow, heatmap.grid, 0, 0, 0)).toBe(rgb(WEATHER_SCALES.snow.stops[2]));
  });

  it('runs the scales to 60 mph, 1.2 in/hr and 3.5 in/hr', () => {
    expect([WEATHER_SCALES.wind.max, WEATHER_SCALES.rain.max, WEATHER_SCALES.snow.max]).toEqual([
      60, 1.2, 3.5,
    ]);
  });

  it('blends the values between two points, so the colour moves along the scale', () => {
    const heatmap = windAt(0, 600);

    const frames = buildScalarFrames(heatmap, 'wind');

    const y = Math.floor(frames.height / 2);
    const colours = [...Array(frames.width).keys()].map((x) => pixel(frames, 0, x, y));
    expect(new Set(colours).size).toBeGreaterThan(10);
  });

  it('leaves outside the corridor and missing values transparent, like risk', () => {
    const base = heatmapOf([[0, 0, 0]]);
    const heatmap = {
      ...base,
      indices: [0, 1],
      scales: SCALES,
      frames: { ...base.frames, wind: [[300, MISSING]] },
    };

    const frames = buildScalarFrames(heatmap, 'wind');

    expect(pixelOver(frames, heatmap.grid, 0, 0, 0)).toBe(rgb(WEATHER_SCALES.wind.stops[2]));
    expect(pixelOver(frames, heatmap.grid, 0, 0, 1)).toBe('clear');
    expect(pixelOver(frames, heatmap.grid, 0, 0, 2)).toBe('clear');
  });

  it('is placed exactly where the risk frames are', () => {
    const heatmap = windAt(100, 200);

    const risk = buildRiskFrames(heatmap);
    const wind = buildScalarFrames(heatmap, 'wind');

    expect([wind.width, wind.height, wind.bounds]).toEqual([risk.width, risk.height, risk.bounds]);
  });
});
