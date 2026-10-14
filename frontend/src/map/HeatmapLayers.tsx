import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { Heatmap } from '../api/heatmap';
import { useForecastHourStore } from '../heatmap/forecastHour';
import { useHeatmapBitmaps } from '../heatmap/useHeatmapBitmaps';
import { HeatmapFader } from './heatmapFader';
import {
  createHeatmapLayers,
  FIRST_FADE_IN_MS,
  FRAME_FADE_MS,
  HEATMAP_OPACITY,
  layerAboveGround,
} from './heatmapBitmapLayers';
import type { LayerStore } from './layerStore';

interface HeatmapLayersProps {
  /** The heatmap to draw; null while there is none. */
  heatmap: Heatmap | null;
  /** Where the heatmap's layers go; the map's overlay draws them under its own. */
  underlay: LayerStore;
}

/**
 * Draws the heatmap frame for the forecast hour, crossfading as the hour changes. Must sit
 * inside a `Map`; renders nothing.
 *
 * It follows the hour by subscribing to the store, not through React state: a slider tick
 * starts a short fade, and each animation frame of it only swaps two deck.gl layers. No
 * component re-renders and nothing is fetched or computed per tick: the bitmaps were all
 * built in a worker when the heatmap arrived.
 */
export function HeatmapLayers({ heatmap, underlay }: HeatmapLayersProps) {
  const { current: map } = useMap();
  const hourStore = useForecastHourStore();
  const drawn = useHeatmapBitmaps(heatmap);

  useEffect(() => {
    if (!drawn || !map) return;
    const { bitmaps, bounds } = drawn;
    const beforeId = layerAboveGround(map.getStyle()?.layers);
    const fader = new HeatmapFader({
      alpha: HEATMAP_OPACITY,
      fadeMs: FRAME_FADE_MS,
      fadeInMs: FIRST_FADE_IN_MS,
    });
    let frame = 0;

    const step = (now: number) => {
      const animating = fader.advance(now);
      underlay.set(createHeatmapLayers({ slots: fader.slots(), bounds, beforeId }));
      frame = animating ? requestAnimationFrame(step) : 0;
    };
    const show = () => {
      fader.show(bitmaps[hourStore.get()], performance.now());
      if (!frame) frame = requestAnimationFrame(step);
    };

    show();
    const unsubscribe = hourStore.subscribe(show);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      underlay.set([]);
    };
  }, [drawn, map, hourStore, underlay]);

  return null;
}
