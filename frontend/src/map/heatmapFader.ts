export interface FaderSlot {
  image: ImageBitmap | null;
  /** The layer's opacity, `0` to the heatmap's own opacity. */
  opacity: number;
}

interface FaderOptions {
  /** The opacity the heatmap settles at over the basemap. */
  alpha: number;
  /** How long one frame takes to replace another. */
  fadeMs: number;
  /** How long the first frame takes to appear. */
  fadeInMs: number;
}

interface Fade {
  /** The slot being faded in, the one being faded out (if any) and when it began. */
  incoming: 0 | 1;
  outgoing: 0 | 1 | null;
  /** The outgoing frame's weight when the fade began. */
  outgoingStart: number;
  startedAt: number;
  duration: number;
}

/**
 * Crossfades between heatmap frames with two layers, one below the other, and no work on the
 * main thread beyond a few numbers per animation frame.
 *
 * Each slot holds a frame and a weight, and the weights always add up to 1 once a frame has
 * faded in. The two layers are drawn one over the other, so a weight `w` is not the layer's
 * opacity: with `alpha` the heatmap's overall opacity, the upper layer is drawn at
 * `alpha * w1` and the lower at `alpha * w0 / (1 - alpha * w1)`. Then the basemap shows through
 * at exactly `1 - alpha` at every moment of the fade, so the heatmap never dims in the middle
 * of a crossfade.
 *
 * A new frame takes the slot that isn't the main one, so no image is ever swapped into a slot
 * that is on screen (that would reload its texture and flash).
 */
export class HeatmapFader {
  private readonly options: FaderOptions;
  private readonly images: [ImageBitmap | null, ImageBitmap | null] = [null, null];
  private readonly weights: [number, number] = [0, 0];
  private fade: Fade | null = null;

  constructor(options: FaderOptions) {
    this.options = options;
  }

  /** The two layers' frames and opacities, lower layer first. */
  slots(): [FaderSlot, FaderSlot] {
    const { alpha } = this.options;
    const [w0, w1] = this.weights;
    return [
      { image: this.images[0], opacity: (alpha * w0) / (1 - alpha * w1) },
      { image: this.images[1], opacity: alpha * w1 },
    ];
  }

  /** Starts fading to `image`, taking over from a fade in progress if there is one. */
  show(image: ImageBitmap, now: number): void {
    const shown = this.fade ? this.images[this.fade.incoming] : this.images[this.main()];
    if (shown === image) return;

    const main = this.main();
    const keep = this.images[main] ? main : null;
    const incoming: 0 | 1 = keep === null ? 0 : keep === 0 ? 1 : 0;
    // Whatever was still fading out is dropped on the spot, and the main frame carries on from
    // the weight everything on screen adds up to, so the total never jumps.
    const total = this.weights[0] + this.weights[1];
    this.images[incoming] = image;
    this.weights[incoming] = 0;
    if (keep === null) {
      this.images[1 - incoming] = null;
      this.weights[1 - incoming] = 0;
    } else {
      this.weights[keep] = total;
    }
    this.fade = {
      incoming,
      outgoing: keep,
      outgoingStart: total,
      startedAt: now,
      duration: keep === null ? this.options.fadeInMs : this.options.fadeMs,
    };
  }

  /** Moves the fade on to `now`. Returns whether it is still going. */
  advance(now: number): boolean {
    const { fade } = this;
    if (!fade) return false;
    const progress = Math.min(1, Math.max(0, (now - fade.startedAt) / fade.duration));
    const eased = progress * (2 - progress);
    this.weights[fade.incoming] = eased;
    if (fade.outgoing !== null) {
      this.weights[fade.outgoing] = fade.outgoingStart * (1 - eased);
    }
    if (progress < 1) return true;
    if (fade.outgoing !== null) this.images[fade.outgoing] = null;
    this.fade = null;
    return false;
  }

  /** The slot with the most weight: the frame that is on screen. */
  private main(): 0 | 1 {
    return this.weights[1] > this.weights[0] ? 1 : 0;
  }
}
