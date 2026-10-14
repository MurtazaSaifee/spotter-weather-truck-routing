import { useEffect } from 'react';
import { useForecastHourStore } from '../heatmap/forecastHour';
import { SECONDS_PER_HOUR, truckAt, type TruckTrack } from '../truck/truckTrack';
import type { LayerStore } from './layerStore';
import { createTruckLayers } from './truckLayers';

interface TruckMarkerProps {
  /** The selected route's line and times; null while there is no route to drive. */
  track: TruckTrack | null;
  /** Where the truck's layers go; the map's overlay draws them above everything else. */
  layers: LayerStore;
}

/**
 * Puts the truck where the selected route has it at the forecast hour. Must sit inside a
 * `Map`; renders nothing.
 *
 * It follows the hour by subscribing to the store, like the heatmap does: a tick only
 * interpolates one position and swaps two deck.gl layers, and nothing re-renders. Choosing
 * another route gives a new track, and the truck moves to it.
 */
export function TruckMarker({ track, layers }: TruckMarkerProps) {
  const hourStore = useForecastHourStore();

  useEffect(() => {
    if (!track) return;
    const place = () => {
      const { position } = truckAt(track, hourStore.get() * SECONDS_PER_HOUR);
      layers.set(createTruckLayers(position));
    };
    place();
    const unsubscribe = hourStore.subscribe(place);
    return () => {
      unsubscribe();
      layers.set([]);
    };
  }, [track, hourStore, layers]);

  return null;
}
