import { createContext, useContext } from 'react';

/** What the heatmap shows: the combined risk, or the raw weather behind it. */
export type HeatmapLayer = 'risk' | 'wind' | 'rain' | 'snow';

/** The layers in the order the toggle offers them; risk first, and the default. */
export const HEATMAP_LAYERS: readonly { layer: HeatmapLayer; label: string }[] = [
  { layer: 'risk', label: 'Risk' },
  { layer: 'wind', label: 'Wind' },
  { layer: 'rain', label: 'Rain' },
  { layer: 'snow', label: 'Snow' },
];

export const DEFAULT_HEATMAP_LAYER: HeatmapLayer = 'risk';

/** The layer on show, for the map to follow without the toggle's props running through it. */
export const HeatmapLayerContext = createContext<HeatmapLayer>(DEFAULT_HEATMAP_LAYER);

export function useHeatmapLayer(): HeatmapLayer {
  return useContext(HeatmapLayerContext);
}
