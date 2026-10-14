import { createContext, useContext } from 'react';
import type { Heatmap } from './payload';

/**
 * How the map's bitmap worker reports to the page. The heatmap's data comes from the API, but
 * its pictures are built in a worker inside the map chunk; when that fails the controls, which
 * live outside the map, must say so and offer a retry.
 */
export interface HeatmapBuild {
  /** Counts the retries: a new number makes the map start a fresh worker. */
  attempt: number;
  /** The worker could not build the pictures of this heatmap. */
  onFailed: (heatmap: Heatmap) => void;
}

const NOT_TRACKED: HeatmapBuild = { attempt: 0, onFailed: () => undefined };

export const HeatmapBuildContext = createContext<HeatmapBuild>(NOT_TRACKED);

export function useHeatmapBuild(): HeatmapBuild {
  return useContext(HeatmapBuildContext);
}
