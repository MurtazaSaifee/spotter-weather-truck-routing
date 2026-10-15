import type { PickingInfo } from '@deck.gl/core';
import { useTheme } from '@mui/material/styles';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  Map,
  type MapEvent,
  type MapRef,
  NavigationControl,
  Popup,
} from 'react-map-gl/maplibre';
import type { Heatmap } from '../heatmap/payload';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { TOUCH_TARGET } from '../theme';
import { useTruckTrack } from '../truck/useTruckTrack';
import { CheckpointDetails } from './CheckpointDetails';
import {
  checkpointDots,
  createCheckpointLayers,
  dotAt,
  nearestDot,
  type CheckpointDot,
} from './checkpointLayers';
import { DeckGLOverlay } from './DeckGLOverlay';
import { HeatmapLayers } from './HeatmapLayers';
import { createLayerStore } from './layerStore';
import { useMapInsets } from '../layout/mapInsets';
import { insetStyle } from './framing';
import { MapFraming } from './MapFraming';
import { CollapsedAttribution, MapStyles } from './MapStyles';
import { PlacePins } from './PlacePins';
import { decodePolyline } from './polyline';
import { placePopup, POPUP_HEIGHT_PX, POPUP_WIDTH_PX, type PopupAnchor } from './popupPlacement';
import { LabelPlacement } from './LabelPlacement';
import {
  createRouteLayers,
  RECOMMENDED_ROUTE_COLOR,
  ROUTE_LAYER_IDS,
  ROUTE_PICKING_RADIUS_PX,
  TOUCH_PICKING_RADIUS_PX,
  type RoutePath,
} from './routeLayers';
import { routeLabels } from '../trip/ranking';
import { TruckMarker } from './TruckMarker';

// The credit the map's own style does not carry. The style's TileJSON already credits OpenFreeMap,
// OpenMapTiles and OpenStreetMap; the forecast is Open-Meteo's, which asks for credit under CC BY 4.0.
const WEATHER_ATTRIBUTION =
  '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a> ' +
  '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>)';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Continental US.
const INITIAL_VIEW_STATE = { longitude: -98.5, latitude: 39.5, zoom: 3.6 };

/**
 * Keeps the map north-up. `dragRotate` and `touchPitch` are map props, but a twist of two fingers
 * and Shift+arrow rotate through handlers that only have a method for it. Pinch zoom and arrow
 * panning stay.
 */
function lockNorthUp({ target }: MapEvent) {
  target.touchZoomRotate.disableRotation();
  target.keyboard.disableRotation();
}

interface TripMapProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  /** The forecast heatmap over the routes; null until it arrives. */
  heatmap: Heatmap | null;
  /** The origin's zone, which checkpoint ETAs are shown in; null until there is a plan. */
  timeZone: string | null;
  selectedRouteId: string | null;
  recommendedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

// The gap between a dot and the popup that describes it.
const POPUP_OFFSET_PX = 12;
const POPUP_EDGE_PX = 8;

/** A checkpoint being described, and where its popup goes so that it stays on the map. */
interface Described {
  dot: CheckpointDot;
  anchor: PopupAnchor;
  maxHeight: number;
  width: number;
}

/** Whether the main way of pointing is a finger: taps, no hover, and thumbs to hit dots with. */
const prefersTouch = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export default function TripMap({
  origin,
  destination,
  routes,
  heatmap,
  timeZone,
  selectedRouteId,
  recommendedRouteId,
  onSelectRoute,
}: TripMapProps) {
  // What the layout covers (a phone's sheet and forecast card): framing, labels and popups
  // keep clear of it.
  const padding = useMapInsets();
  const theme = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [touch] = useState(prefersTouch);
  // The route labels change when the map stops moving, outside React's render, like the truck.
  const [labelLayers] = useState(createLayerStore);
  // The heatmap's layers change every animation frame while it fades; they live in a store the
  // overlay reads, so a slider tick never re-renders this component.
  const [heatmapLayers] = useState(createLayerStore);
  // The truck moves the same way: it follows the hour store and draws above everything else.
  const [truckLayers] = useState(createLayerStore);
  const truckTrack = useTruckTrack(routes.find(({ id }) => id === selectedRouteId) ?? null);
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
  const [hovered, setHovered] = useState<Described | null>(null);
  const [pinned, setPinned] = useState<Described | null>(null);
  // A dot from an earlier plan (another interval) is gone, and so is what it described.
  const stillShown = (shown: Described | null) =>
    shown && dots.includes(shown.dot) ? shown : null;
  const described = stillShown(hovered) ?? stillShown(pinned);

  /** Works out where the popup for `dot` fits on the map as it is now. */
  function describe(dot: CheckpointDot): Described | null {
    const map = mapRef.current;
    if (!map) return null;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const popupWidth = Math.min(POPUP_WIDTH_PX, width - 2 * POPUP_EDGE_PX);
    const { x, y } = map.project(dot.position);
    const { anchor, maxHeight } = placePopup({
      point: [x, y],
      size: [popupWidth, POPUP_HEIGHT_PX],
      area: { width, height, padding },
      offset: POPUP_OFFSET_PX,
    });
    return { dot, anchor, maxHeight, width: popupWidth };
  }

  function handleHover(info: PickingInfo) {
    const dot = dotAt(info);
    setHovered((current) => (dot ? (current?.dot === dot ? current : describe(dot)) : null));
  }

  function handleClick(info: PickingInfo) {
    const dot = dotAt(info);
    if (dot) return setPinned(describe(dot));
    // A dot a few pixels across is too small for a fingertip: a tap near a dot of the selected
    // route (not one on another route's line or a label, which select that route) picks it.
    const layerId = info.layer?.id;
    const onOtherRoute =
      layerId !== undefined &&
      ROUTE_LAYER_IDS.has(layerId) &&
      (info.object as RoutePath).id !== selectedRouteId;
    const map = mapRef.current;
    if (touch && map && !onOtherRoute && layerId !== 'route-labels') {
      const near = nearestDot(
        dots.filter((candidate) => candidate.routeId === selectedRouteId),
        [info.x, info.y],
        (position) => {
          const { x, y } = map.project(position);
          return [x, y];
        },
        TOUCH_TARGET / 2,
      );
      if (near) return setPinned(describe(near));
    }
    setPinned(null);
  }

  const blockedRouteIds = useMemo(
    () => new Set(routes.filter((route) => route.blocked).map((route) => route.id)),
    [routes],
  );
  const names = useMemo(() => routeLabels(routes), [routes]);

  const layers = [
    ...createRouteLayers({
      paths,
      selectedRouteId,
      recommendedRouteId,
      blockedRouteIds,
      onSelectRoute,
      selectedColor: theme.palette.primary.main,
      recommendedColor: RECOMMENDED_ROUTE_COLOR,
      otherColor: theme.palette.grey[500],
    }),
    ...createCheckpointLayers({ dots, selectedRouteId }),
  ];

  return (
    <Map
      ref={mapRef}
      mapLib={maplibregl}
      mapStyle={MAP_STYLE}
      initialViewState={INITIAL_VIEW_STATE}
      style={{ width: '100%', height: '100%', ...insetStyle(padding) }}
      attributionControl={false}
      // A truck route needs no rotation or tilt, and nobody finds the Ctrl/right-drag gesture:
      // the map stays north-up, so it has no compass either.
      dragRotate={false}
      touchPitch={false}
      onLoad={lockNorthUp}
    >
      <MapStyles />
      {/* Collapses to an info button on a narrow map; every credit stays one tap away. */}
      <AttributionControl position="bottom-right" customAttribution={WEATHER_ATTRIBUTION} />
      <CollapsedAttribution />
      <NavigationControl position="top-right" showCompass={false} />
      <PlacePins origin={origin} destination={destination} />
      <MapFraming origin={origin} destination={destination} routes={paths} insets={padding} />
      <HeatmapLayers heatmap={heatmap} underlay={heatmapLayers} />
      <LabelPlacement
        routes={routes}
        paths={paths}
        names={names}
        selectedRouteId={selectedRouteId}
        recommendedRouteId={recommendedRouteId}
        onSelectRoute={onSelectRoute}
        insets={padding}
        layers={labelLayers}
      />
      <TruckMarker track={truckTrack} layers={truckLayers} />
      <DeckGLOverlay
        layers={layers}
        underlay={heatmapLayers}
        labelLayers={labelLayers}
        topLayers={truckLayers}
        pickingRadius={touch ? TOUCH_PICKING_RADIUS_PX : ROUTE_PICKING_RADIUS_PX}
        onHover={handleHover}
        onClick={handleClick}
      />
      {described && timeZone && (
        <Popup
          longitude={described.dot.position[0]}
          latitude={described.dot.position[1]}
          anchor={described.anchor}
          offset={POPUP_OFFSET_PX}
          maxWidth="none"
          closeButton={touch}
          onClose={() => setPinned(null)}
          closeOnClick={false}
          focusAfterOpen={false}
        >
          <CheckpointDetails
            checkpoint={described.dot.checkpoint}
            routeLabel={described.dot.routeLabel}
            timeZone={timeZone}
            width={described.width}
            maxHeight={described.maxHeight}
          />
        </Popup>
      )}
    </Map>
  );
}
