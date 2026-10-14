import dayjs from 'dayjs';
import type { Heatmap } from '../../heatmap/payload';

const HOURS = 49;
const DEPARTURE = '2026-10-15T08:00:00-05:00';

/**
 * A heatmap of a 2 by 3 grid with four points of it in the corridor, 49 frames from the
 * chicagoToDallas plan's departure. Page tests never draw it.
 */
export const heatmapOfChicagoToDallas: Heatmap = {
  grid: { origin_lat: 41.5, origin_lng: -88, spacing_deg: 0.1, rows: 2, cols: 3 },
  indices: [0, 1, 4, 5],
  timestamps: Array.from({ length: HOURS }, (_, hour) =>
    dayjs(DEPARTURE).add(hour, 'hour').toISOString(),
  ),
  scales: { wind: 10, rain: 1000, snow: 1000 },
  frames: {
    risk: Array.from({ length: HOURS }, () => [0, 1, 2, -1]),
    wind: Array.from({ length: HOURS }, () => [120, 150, 400, -1]),
    rain: Array.from({ length: HOURS }, () => [0, 0, 34, -1]),
    snow: Array.from({ length: HOURS }, () => [0, 500, 0, -1]),
  },
};
