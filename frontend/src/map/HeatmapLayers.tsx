import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { Heatmap } from '../api/heatmap';
import { useForecastHourStore } from '../heatmap/forecastHour';
import { useHeatmapLayer } from '../heatmap/layer';
import { useHeatmapBitmaps } from '../heatmap/useHeatmapBitmaps';
import { layerAboveGround } from './heatmapBitmapLayers';
import { HeatmapPainter } from './heatmapPainter';
import type { LayerStore } from './layerStore';

interface HeatmapLayersProps {
  /** The heatmap to draw; null while there is none. */
  heatmap: Heatmap | null;
  /** Where the heatmap's layers go; the map's overlay draws them under its own. */
  underlay: LayerStore;
}

/**
 * Draws the heatmap's layer on show (risk, wind, rain or snow) at the forecast hour. Must sit
 * inside a `Map`; renders nothing. The painting itself is `HeatmapPainter`'s: this ties its
 * life to the map and the heatmap, and hands it each layer's frames as they are ready.
 */
export function HeatmapLayers({ heatmap, underlay }: HeatmapLayersProps) {
  const { current: map } = useMap();
  const hourStore = useForecastHourStore();
  const drawn = useHeatmapBitmaps(heatmap, useHeatmapLayer());
  const painter = useRef<HeatmapPainter | null>(null);
  const latest = useRef(drawn);

  useEffect(() => {
    latest.current = drawn;
    painter.current?.setFrames(drawn);
  }, [drawn]);

  // A new heatmap starts a new painter (the old one clears what it drew); the frames then
  // arrive through the effect above.
  useEffect(() => {
    if (!heatmap || !map) return;
    const instance = new HeatmapPainter({
      hourStore,
      underlay,
      beforeId: layerAboveGround(map.getStyle()?.layers),
    });
    instance.setFrames(latest.current);
    painter.current = instance;
    return () => {
      painter.current = null;
      instance.dispose();
    };
  }, [heatmap, map, hourStore, underlay]);

  return null;
}
