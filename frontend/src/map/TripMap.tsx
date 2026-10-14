import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  AttributionControl,
  Map,
  NavigationControl,
} from 'react-map-gl/maplibre';
import type { Place } from '../api/places';
import { DeckGLOverlay } from './DeckGLOverlay';
import { PlacePins } from './PlacePins';

// MapLibre 6 guesses its worker as a sibling file of its own module URL, which
// Vite breaks (dev pre-bundling moves the module; build hashes it into a chunk).
// Point it at the worker file as an emitted asset instead. The ?url import keeps
// the worker out of every JS chunk, so the entry chunk stays free of MapLibre.
maplibregl.setWorkerUrl(workerUrl);

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Continental US.
const INITIAL_VIEW_STATE = { longitude: -98.5, latitude: 39.5, zoom: 3.6 };

interface TripMapProps {
  origin: Place | null;
  destination: Place | null;
}

export default function TripMap({ origin, destination }: TripMapProps) {
  return (
    <Map
      mapLib={maplibregl}
      mapStyle={MAP_STYLE}
      initialViewState={INITIAL_VIEW_STATE}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
    >
      {/* The style's TileJSON already credits OpenFreeMap, OpenMapTiles and OSM. */}
      <AttributionControl position="bottom-right" compact={false} />
      <NavigationControl position="top-right" />
      <PlacePins origin={origin} destination={destination} />
      <DeckGLOverlay layers={[]} />
    </Map>
  );
}
