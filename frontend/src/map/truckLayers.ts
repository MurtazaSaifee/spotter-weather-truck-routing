import { ScatterplotLayer } from '@deck.gl/layers';
import { TRUCK_COLOR } from '../truck/truckColors';
import type { LngLat } from './polyline';
import { rgb } from './routeLayers';

const DISC_RADIUS_PX = 8;
const RING_PX = 3;
const HALO_RADIUS_PX = 17;
// A slider tick moves the truck up to an hour of driving; glide there rather than jump.
const GLIDE_MS = 150;

/**
 * The truck: a black disc with a white ring on a translucent white halo. The halo keeps it
 * visible over the dark ends of the heatmap and the ring over the route lines. Both layers are
 * rebuilt with the same ids on every tick, so deck.gl glides the position between ticks.
 * Not pickable: it must not take hovers or clicks from the checkpoints and routes it sits on.
 */
export function createTruckLayers(position: LngLat) {
  const common = {
    data: [position],
    getPosition: (point: LngLat) => point,
    radiusUnits: 'pixels' as const,
    transitions: { getPosition: GLIDE_MS },
    pickable: false,
  };
  return [
    new ScatterplotLayer<LngLat>({
      ...common,
      id: 'truck-halo',
      getFillColor: [255, 255, 255, 140],
      getRadius: HALO_RADIUS_PX,
    }),
    new ScatterplotLayer<LngLat>({
      ...common,
      id: 'truck',
      getFillColor: rgb(TRUCK_COLOR),
      getRadius: DISC_RADIUS_PX,
      stroked: true,
      getLineColor: [255, 255, 255],
      getLineWidth: RING_PX,
      lineWidthUnits: 'pixels',
    }),
  ];
}
