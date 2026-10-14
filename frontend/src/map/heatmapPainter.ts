import type { ForecastHourStore } from '../heatmap/forecastHour';
import type { HeatmapBitmaps } from '../heatmap/useHeatmapBitmaps';
import { HeatmapFader } from './heatmapFader';
import {
  createHeatmapLayers,
  FIRST_FADE_IN_MS,
  FRAME_FADE_MS,
  HEATMAP_OPACITY,
} from './heatmapBitmapLayers';
import type { LayerStore } from './layerStore';

interface PainterOptions {
  hourStore: ForecastHourStore;
  /** Where the heatmap's layers go; the map's overlay draws them under its own. */
  underlay: LayerStore;
  /** The basemap layer to slot the heatmap beneath. */
  beforeId?: string;
}

/**
 * Draws one heatmap on the map: the frame for the forecast hour of the layer on show,
 * crossfading whenever either changes. It follows the hour by subscribing to the store, not
 * through React state: a slider tick (or a layer switch) starts a short fade, and each
 * animation frame of it only swaps two deck.gl layers. Nothing is fetched or computed per
 * tick: the bitmaps were all built in a worker.
 *
 * A layer switch is a fade like any other, from the frame on screen to the new layer's frame
 * for the same hour, so the hour and the crossfade carry across toggles.
 */
export class HeatmapPainter {
  private readonly options: PainterOptions;
  private readonly fader = new HeatmapFader({
    alpha: HEATMAP_OPACITY,
    fadeMs: FRAME_FADE_MS,
    fadeInMs: FIRST_FADE_IN_MS,
  });
  private readonly unsubscribe: () => void;
  private frames: HeatmapBitmaps | null = null;
  private frame = 0;

  constructor(options: PainterOptions) {
    this.options = options;
    this.unsubscribe = options.hourStore.subscribe(() => this.show());
  }

  /** Shows `frames`, the bitmaps of the layer now on show, from the current hour on. */
  setFrames(frames: HeatmapBitmaps | null) {
    this.frames = frames;
    this.show();
  }

  /** Stops painting and clears the heatmap off the map. */
  dispose() {
    this.unsubscribe();
    cancelAnimationFrame(this.frame);
    this.options.underlay.set([]);
  }

  private show() {
    const image = this.frames?.bitmaps[this.options.hourStore.get()];
    if (!image) return;
    this.fader.show(image, performance.now());
    if (!this.frame) this.frame = requestAnimationFrame(this.step);
  }

  private readonly step = (now: number) => {
    // Cleared whatever happens: a paint that throws must not leave `frame` set, or `show` would
    // never ask for another one.
    this.frame = 0;
    if (!this.frames) return;
    let animating = false;
    try {
      animating = this.fader.advance(now);
      this.options.underlay.set(
        createHeatmapLayers({
          slots: this.fader.slots(),
          bounds: this.frames.bounds,
          beforeId: this.options.beforeId,
        }),
      );
    } finally {
      if (animating) this.frame = requestAnimationFrame(this.step);
    }
  };
}
