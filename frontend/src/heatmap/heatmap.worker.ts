import type { Heatmap } from '../api/heatmap';
import { buildRiskFrames, type Bounds } from './frames';

/** What the page sends: the heatmap's grid and its risk frames. */
export type FrameRequest = Pick<Heatmap, 'grid' | 'indices'> & {
  frames: Pick<Heatmap['frames'], 'risk'>;
};

/** What the worker answers: a bitmap per hour, and where to place them. */
export interface FrameResponse {
  bitmaps: ImageBitmap[];
  bounds: Bounds;
}

/**
 * Builds the heatmap's bitmaps off the main thread, so a 49-frame build never delays a
 * slider drag or a map pan. The bitmaps are transferred, not copied.
 */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<FrameRequest>) => void): void;
  postMessage(message: FrameResponse, transfer: Transferable[]): void;
};

scope.addEventListener('message', (event) => {
  void respond(event.data);
});

async function respond(request: FrameRequest) {
  const { width, height, bounds, frames } = buildRiskFrames(request);
  const bitmaps = await Promise.all(
    frames.map((pixels) =>
      createImageBitmap(new ImageData(pixels as ImageDataArray, width, height), {
        // The colours are opaque or fully transparent: leave them as they are.
        premultiplyAlpha: 'none',
      }),
    ),
  );
  scope.postMessage({ bitmaps, bounds }, bitmaps);
}
