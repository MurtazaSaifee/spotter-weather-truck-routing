import { useTheme } from '@mui/material/styles';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo } from 'react';
import {
  AttributionControl,
  Map,
  NavigationControl,
} from 'react-map-gl/maplibre';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { DeckGLOverlay } from './DeckGLOverlay';
import { MapFraming } from './MapFraming';
import { PlacePins } from './PlacePins';
import { decodePolyline } from './polyline';
import { createRouteLayers, ROUTE_PICKING_RADIUS_PX } from './routeLayers';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Continental US.
const INITIAL_VIEW_STATE = { longitude: -98.5, latitude: 39.5, zoom: 3.6 };

interface TripMapProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

export default function TripMap({
  origin,
  destination,
  routes,
  selectedRouteId,
  onSelectRoute,
}: TripMapProps) {
  const theme = useTheme();
  // Decoding is the expensive part; selecting a route must not repeat it.
  const paths = useMemo(
    () => routes.map(({ id, geometry }) => ({ id, path: decodePolyline(geometry) })),
    [routes],
  );
  const layers = createRouteLayers({
    paths,
    selectedRouteId,
    onSelectRoute,
    selectedColor: theme.palette.primary.main,
    otherColor: theme.palette.grey[500],
  });

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
      <MapFraming origin={origin} destination={destination} routes={paths} />
      <DeckGLOverlay layers={layers} pickingRadius={ROUTE_PICKING_RADIUS_PX} />
    </Map>
  );
}
