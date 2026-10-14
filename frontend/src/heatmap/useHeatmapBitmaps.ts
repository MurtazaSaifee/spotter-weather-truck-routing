import { useEffect, useState } from 'react';
import type { Heatmap } from '../api/heatmap';
import type { Bounds } from './frames';
import type { FrameRequest, FrameResponse } from './heatmap.worker';

/** The heatmap drawn: a bitmap per hour and where on the map they go. */
export interface HeatmapBitmaps {
  /** One image per frame of the heatmap, in order. */
  bitmaps: ImageBitmap[];
  bounds: Bounds;
}

/**
 * The risk bitmaps of `heatmap`, built in a Web Worker as soon as it arrives; null until they
 * are ready and whenever there is no heatmap. They are released (and the worker stopped) when
 * the heatmap is replaced, which is what happens when a new trip is planned.
 */
export function useHeatmapBitmaps(heatmap: Heatmap | null): HeatmapBitmaps | null {
  const [built, setBuilt] = useState<{ source: Heatmap; result: HeatmapBitmaps } | null>(null);

  useEffect(() => {
    if (!heatmap) return;
    const worker = new Worker(new URL('./heatmap.worker.ts', import.meta.url), {
      type: 'module',
    });
    let bitmaps: ImageBitmap[] = [];
    worker.addEventListener('message', (event: MessageEvent<FrameResponse>) => {
      bitmaps = event.data.bitmaps;
      setBuilt({ source: heatmap, result: event.data });
    });
    const request: FrameRequest = {
      grid: heatmap.grid,
      indices: heatmap.indices,
      frames: { risk: heatmap.frames.risk },
    };
    worker.postMessage(request);
    return () => {
      worker.terminate();
      bitmaps.forEach((bitmap) => bitmap.close());
    };
  }, [heatmap]);

  return heatmap && built?.source === heatmap ? built.result : null;
}
