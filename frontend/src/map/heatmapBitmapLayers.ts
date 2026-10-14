import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { BitmapLayer } from '@deck.gl/layers';
import type { Bounds } from '../heatmap/frames';
import type { FaderSlot } from './heatmapFader';

/** How opaque the heatmap settles: the basemap's roads and places still read through it. */
export const HEATMAP_OPACITY = 0.62;
export const FRAME_FADE_MS = 150;
export const FIRST_FADE_IN_MS = 450;

const LAYER_IDS = ['heatmap-lower', 'heatmap-upper'] as const;

interface HeatmapLayerOptions {
  /** The fader's two layers, lower first. */
  slots: [FaderSlot, FaderSlot];
  bounds: Bounds;
  /** The basemap layer to slot the heatmap beneath. */
  beforeId?: string;
}

/**
 * The heatmap as deck.gl layers: one bitmap per fader slot, placed by longitude and latitude
 * (`_imageCoordinateSystem`) so the grid's evenly spaced rows land where Web Mercator puts
 * them. A slot without a frame draws nothing.
 */
export function createHeatmapLayers({ slots, bounds, beforeId }: HeatmapLayerOptions) {
  return slots.flatMap(({ image, opacity }, slot) =>
    image
      ? [
          new BitmapLayer({
            id: LAYER_IDS[slot],
            image,
            bounds,
            _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            opacity,
            visible: opacity > 0,
            beforeId,
            pickable: false,
          }),
        ]
      : [],
  );
}

/**
 * The basemap layer to put the heatmap beneath: the first that is not ground (the background
 * and its fills). The heatmap then tints land and water but leaves roads, borders and labels
 * crisp above it.
 */
export function layerAboveGround(layers: { id: string; type: string }[] | undefined) {
  return layers?.find(({ type }) => type !== 'background' && type !== 'fill')?.id;
}
