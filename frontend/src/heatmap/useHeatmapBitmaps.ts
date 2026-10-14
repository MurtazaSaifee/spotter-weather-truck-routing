import { useEffect, useRef, useState } from 'react';
import { useHeatmapBuild } from './buildStatus';
import type { Heatmap } from './payload';
import type { Bounds, FrameRequest } from './frames';
import type { FrameMessage } from './heatmap.worker';
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
 * If the worker fails, the page is told (`HeatmapBuildContext`) and shows its error state; a
 * retry there starts a new worker for the layers still missing.
 *
 * A bitmap is closed only when its heatmap is replaced or the map goes away, never while it
 * is still the heatmap on show: a layer may be drawing it. Layers are built once per heatmap,
 * so no bitmap is ever replaced by another.
 */
export function useHeatmapBitmaps(
  heatmap: Heatmap | null,
  layer: HeatmapLayer,
): HeatmapBitmaps | null {
  const { attempt, onFailed } = useHeatmapBuild();
  const [built, setBuilt] = useState<Built | null>(null);
  const worker = useRef<{ worker: Worker; asked: Set<HeatmapLayer> } | null>(null);
  // What has been built for the heatmap on show: its bitmaps, and which layers they are of.
  const owned = useRef<{ bitmaps: ImageBitmap[]; arrived: Set<HeatmapLayer> }>({
    bitmaps: [],
    arrived: new Set(),
  });

  // Releases the bitmaps when the heatmap is replaced, which is when a new trip is planned, or
  // when the map unmounts. The painter in the same component clears its layers in the same
  // commit, so nothing draws a bitmap after it is closed.
  useEffect(() => {
    const mine = owned.current;
    return () => {
      mine.bitmaps.forEach((bitmap) => bitmap.close());
      owned.current = { bitmaps: [], arrived: new Set() };
    };
  }, [heatmap]);

  // The worker lives as long as the heatmap does, or until it fails and a retry replaces it.
  useEffect(() => {
    if (!heatmap) return;
    const instance = new Worker(new URL('./heatmap.worker.ts', import.meta.url), {
      type: 'module',
    });
    const fail = () => onFailed(heatmap);
    instance.addEventListener('message', (event: MessageEvent<FrameMessage>) => {
      if ('failed' in event.data) return fail();
      const { layer: arrived, ...result } = event.data;
      owned.current.bitmaps.push(...result.bitmaps);
      owned.current.arrived.add(arrived);
      setBuilt((current) => ({
        source: heatmap,
        layers: { ...(current?.source === heatmap ? current.layers : {}), [arrived]: result },
        latest: arrived,
      }));
    });
    instance.addEventListener('error', fail);
    instance.addEventListener('messageerror', fail);
    // A retry asks only for what is still missing.
    worker.current = { worker: instance, asked: new Set(owned.current.arrived) };
    return () => {
      worker.current = null;
      instance.terminate();
    };
  }, [heatmap, attempt, onFailed]);

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
  }, [heatmap, layer, attempt]);

  if (!heatmap || built?.source !== heatmap) return null;
  return built.layers[layer] ?? built.layers[built.latest] ?? null;
}
