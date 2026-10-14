import { useEffect, useRef, useState } from 'react';
import type { Heatmap } from './payload';
import type { Bounds, FrameRequest } from './frames';
import type { FrameResponse } from './heatmap.worker';
import type { HeatmapLayer } from './layer';

/** One layer of the heatmap drawn: a bitmap per hour and where on the map they go. */
export interface HeatmapBitmaps {
  /** One image per frame of the heatmap, in order. */
  bitmaps: ImageBitmap[];
  bounds: Bounds;
}

interface Built {
  source: Heatmap;
  /** Every layer built so far, kept for the life of the heatmap. */
  layers: Partial<Record<HeatmapLayer, HeatmapBitmaps>>;
  /** The layer that arrived last. */
  latest: HeatmapLayer;
}

/**
 * The bitmaps of `layer` for `heatmap`, built in a Web Worker the first time the layer is
 * asked for and kept after that, so switching back to a layer is instant. While a layer that
 * has not been built yet is on its way, the layer that arrived last stays on screen; the
 * result is null until the first one is ready and whenever there is no heatmap.
 *
 * The worker and every bitmap are released when the heatmap is replaced, which is what
 * happens when a new trip is planned.
 */
export function useHeatmapBitmaps(
  heatmap: Heatmap | null,
  layer: HeatmapLayer,
): HeatmapBitmaps | null {
  const [built, setBuilt] = useState<Built | null>(null);
  const worker = useRef<{ worker: Worker; asked: Set<HeatmapLayer> } | null>(null);

  useEffect(() => {
    if (!heatmap) return;
    const instance = new Worker(new URL('./heatmap.worker.ts', import.meta.url), {
      type: 'module',
    });
    const owned: ImageBitmap[] = [];
    instance.addEventListener('message', (event: MessageEvent<FrameResponse>) => {
      const { layer: arrived, ...result } = event.data;
      owned.push(...result.bitmaps);
      setBuilt((current) => ({
        source: heatmap,
        layers: { ...(current?.source === heatmap ? current.layers : {}), [arrived]: result },
        latest: arrived,
      }));
    });
    worker.current = { worker: instance, asked: new Set() };
    return () => {
      worker.current = null;
      instance.terminate();
      owned.forEach((bitmap) => bitmap.close());
    };
  }, [heatmap]);

  // Declared after the worker's effect: on a new heatmap it runs once the worker exists.
  useEffect(() => {
    if (!heatmap || !worker.current || worker.current.asked.has(layer)) return;
    worker.current.asked.add(layer);
    const request: FrameRequest = {
      layer,
      grid: heatmap.grid,
      indices: heatmap.indices,
      scales: heatmap.scales,
      values: heatmap.frames[layer],
    };
    worker.current.worker.postMessage(request);
  }, [heatmap, layer]);

  if (!heatmap || built?.source !== heatmap) return null;
  return built.layers[layer] ?? built.layers[built.latest] ?? null;
}
