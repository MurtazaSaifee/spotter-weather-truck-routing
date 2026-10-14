import { useTheme } from '@mui/material/styles';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo, useState } from 'react';
import {
  AttributionControl,
  Map,
  NavigationControl,
  Popup,
} from 'react-map-gl/maplibre';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { CheckpointDetails } from './CheckpointDetails';
import {
  checkpointDots,
  createCheckpointLayers,
  dotAt,
  type CheckpointDot,
} from './checkpointLayers';
import { DeckGLOverlay } from './DeckGLOverlay';
import { MapFraming } from './MapFraming';
import { PlacePins } from './PlacePins';
import { decodePolyline } from './polyline';
import { createRouteLayers, ROUTE_PICKING_RADIUS_PX } from './routeLayers';

const WEATHER_ATTRIBUTION =
  '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a> ' +
  '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>)';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Continental US.
const INITIAL_VIEW_STATE = { longitude: -98.5, latitude: 39.5, zoom: 3.6 };

interface TripMapProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  /** The origin's zone, which checkpoint ETAs are shown in; null until there is a plan. */
  timeZone: string | null;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

export default function TripMap({
  origin,
  destination,
  routes,
  timeZone,
  selectedRouteId,
  onSelectRoute,
}: TripMapProps) {
  const theme = useTheme();
  // Decoding is the expensive part; selecting a route must not repeat it. Planning again
  // with another interval returns new route objects with the same lines: keep the decoded
  // paths, so the camera stays where the driver left it.
  const geometryKey = routes.map(({ id, geometry }) => `${id}:${geometry}`).join(' ');
  const paths = useMemo(
    () => routes.map(({ id, geometry }) => ({ id, path: decodePolyline(geometry) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `geometryKey` stands for the lines
    [geometryKey],
  );
  const dots = useMemo(() => checkpointDots(routes), [routes]);
  // Hovering describes a checkpoint; tapping keeps it described (there is no hover on a phone).
  const [hovered, setHovered] = useState<CheckpointDot | null>(null);
  const [pinned, setPinned] = useState<CheckpointDot | null>(null);
  // A dot from an earlier plan (another interval) is gone, and so is what it described.
  const stillShown = (dot: CheckpointDot | null) => (dot && dots.includes(dot) ? dot : null);
  const described = stillShown(hovered) ?? stillShown(pinned);

  const selectedColor = theme.palette.primary.main;
  const otherColor = theme.palette.grey[500];
  const layers = [
    ...createRouteLayers({ paths, selectedRouteId, onSelectRoute, selectedColor, otherColor }),
    ...createCheckpointLayers({ dots, selectedRouteId, selectedColor, otherColor }),
  ];

  return (
    <Map
      mapLib={maplibregl}
      mapStyle={MAP_STYLE}
      initialViewState={INITIAL_VIEW_STATE}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
    >
      {/* The style's TileJSON already credits OpenFreeMap, OpenMapTiles and OSM; the forecast
          is Open-Meteo's, which asks for credit under CC BY 4.0. */}
      <AttributionControl
        position="bottom-right"
        compact={false}
        customAttribution={WEATHER_ATTRIBUTION}
      />
      <NavigationControl position="top-right" />
      <PlacePins origin={origin} destination={destination} />
      <MapFraming origin={origin} destination={destination} routes={paths} />
      <DeckGLOverlay
        layers={layers}
        pickingRadius={ROUTE_PICKING_RADIUS_PX}
        onHover={(info) => setHovered(dotAt(info))}
        onClick={(info) => setPinned(dotAt(info))}
      />
      {described && timeZone && (
        <Popup
          longitude={described.position[0]}
          latitude={described.position[1]}
          anchor="bottom"
          offset={12}
          closeButton={false}
          closeOnClick={false}
          focusAfterOpen={false}
        >
          <CheckpointDetails
            checkpoint={described.checkpoint}
            routeLabel={described.routeLabel}
            timeZone={timeZone}
          />
        </Popup>
      )}
    </Map>
  );
}
