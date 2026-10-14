import { buildFrames, type Bounds, type FrameRequest } from './frames';
import type { HeatmapLayer } from './layer';

/** What the worker answers: a bitmap per hour of the layer asked for, and where to place them. */
export interface FrameResponse {
  layer: HeatmapLayer;
  bitmaps: ImageBitmap[];
  bounds: Bounds;
}

/** What the worker answers when it could not build a layer. */
export interface FrameFailure {
  layer: HeatmapLayer;
  failed: true;
}

export type FrameMessage = FrameResponse | FrameFailure;

/**
 * Builds a layer's bitmaps off the main thread, so a 49-frame build never delays a slider drag
 * or a map pan. The bitmaps are transferred, not copied. It holds nothing between requests:
 * the page asks for a layer when it is first shown and keeps what comes back.
 */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<FrameRequest>) => void): void;
  postMessage(message: FrameMessage, transfer: Transferable[]): void;
};

scope.addEventListener('message', (event) => {
  // An async function's failure is not an `error` event on the page's side, so it is reported.
  respond(event.data).catch(() => scope.postMessage({ layer: event.data.layer, failed: true }, []));
});

async function respond(request: FrameRequest) {
  const { width, height, bounds, frames } = buildFrames(request);
  const bitmaps = await Promise.all(
    frames.map((pixels) =>
      createImageBitmap(new ImageData(pixels as ImageDataArray, width, height), {
        // The colours are opaque or fully transparent: leave them as they are.
        premultiplyAlpha: 'none',
      }),
    ),
  );
  scope.postMessage({ layer: request.layer, bitmaps, bounds }, bitmaps);
}
