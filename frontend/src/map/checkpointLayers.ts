import { ScatterplotLayer } from '@deck.gl/layers';
import type { Checkpoint } from '../api/plan';
import { riskStyle } from '../risk/palette';
import { type CheckpointDot, OTHER_LAYER_ID, SELECTED_LAYER_ID } from './checkpointDots';
import { rgb } from './colour';

/**
 * How big a dot is: its radius on the ground, held between two pixel sizes. On the ground, it
 * grows with the zoom on the GPU, with no redraw by React. The floor keeps it visible at the
 * zoom where the whole trip fits, where it is small enough to leave the heatmap readable; the
 * ceiling stops it swallowing the road once the driver is zoomed in.
 */
interface DotSize {
  meters: number;
  minPx: number;
  maxPx: number;
}

export const SELECTED_DOT: DotSize = { meters: 1600, minPx: 3.5, maxPx: 8 };
export const OTHER_DOT: DotSize = { meters: 1000, minPx: 2.5, maxPx: 5.5 };
const OUTLINE_PX = 1.5;

// Metres per pixel at zoom 0 on the equator, for the 512 px tiles of MapLibre and deck.gl.
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.517;

/** The radius a dot is drawn at, in pixels, at a zoom and latitude. */
export function dotRadiusPx({ meters, minPx, maxPx }: DotSize, zoom: number, latitude: number) {
  const metersPerPixel =
    (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return Math.min(maxPx, Math.max(minPx, meters / metersPerPixel));
}

const riskColor = ({ risk }: Checkpoint) => rgb(riskStyle(risk.level).color);

interface CheckpointLayerOptions {
  dots: CheckpointDot[];
  selectedRouteId: string | null;
}

/** Dots on the routes, coloured by risk level: the selected route's on top and a little larger. */
export function createCheckpointLayers({ dots, selectedRouteId }: CheckpointLayerOptions) {
  const layer = (id: string, data: CheckpointDot[], size: DotSize) =>
    new ScatterplotLayer<CheckpointDot>({
      id,
      data,
      getPosition: (dot) => dot.position,
      getFillColor: (dot) => riskColor(dot.checkpoint),
      getLineColor: [255, 255, 255],
      getRadius: size.meters,
      radiusUnits: 'meters',
      radiusMinPixels: size.minPx,
      radiusMaxPixels: size.maxPx,
      stroked: true,
      getLineWidth: OUTLINE_PX,
      lineWidthUnits: 'pixels',
      pickable: true,
    });

  return [
    layer(
      OTHER_LAYER_ID,
      dots.filter((dot) => dot.routeId !== selectedRouteId),
      OTHER_DOT,
    ),
    layer(
      SELECTED_LAYER_ID,
      dots.filter((dot) => dot.routeId === selectedRouteId),
      SELECTED_DOT,
    ),
  ];
}
