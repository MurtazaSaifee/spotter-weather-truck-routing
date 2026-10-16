import type { PickingInfo } from '@deck.gl/core';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  Map,
  type MapRef,
  NavigationControl,
  Popup,
  useMap,
} from 'react-map-gl/maplibre';
import type { Heatmap } from '../heatmap/payload';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { TOUCH_TARGET } from '../theme';
import { useTruckTrack } from '../truck/useTruckTrack';
import { CheckpointDetails } from './CheckpointDetails';
import { checkpointDots, dotAt, nearestDot, type CheckpointDot } from './checkpointDots';
import { attachCommandRotate } from './commandRotate';
import { createLayerStore } from './layerStore';
import { useMapInsets } from '../layout/mapInsets';
import { constrainCamera, insetStyle, WORLD_BOUNDS } from './framing';
import { MapFraming } from './MapFraming';
import { CollapsedAttribution, MapStyles } from './MapStyles';
import { PlacePins } from './PlacePins';
import { decodePolyline } from './polyline';
import { placePopup, POPUP_HEIGHT_PX, POPUP_WIDTH_PX, type PopupAnchor } from './popupPlacement';
import type { RoutePath } from './routeLayers';
import { ROUTE_LAYER_IDS } from './routeStyle';
import { routeLabels } from '../trip/ranking';

// deck.gl is loaded when there is a plan to draw, not with the map: see DeckMapLayers.
const DeckMapLayers = lazy(() => import('./DeckMapLayers'));

// The credit the map's own style does not carry. The style's TileJSON already credits OpenFreeMap,
// OpenMapTiles and OpenStreetMap; the forecast is Open-Meteo's, which asks for credit under CC BY 4.0.
const WEATHER_ATTRIBUTION =
  '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a> ' +
  '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>)';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// The whole world, so the map starts anywhere a trip might be. Fitting bounds (rather than a
// zoom) works at any width, down to a 375 px phone.
const INITIAL_VIEW_STATE = { bounds: WORLD_BOUNDS };

/** Makes a Command-drag turn the map, like Ctrl-drag; see `attachCommandRotate`. Inside a `Map`. */
function CommandRotate() {
  const { current: map } = useMap();
  useEffect(() => (map ? attachCommandRotate(map.getMap()) : undefined), [map]);
  return null;
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
// What MapLibre's popup adds around the content (its padding): placement has to plan for the
// whole box, not just the content.
const POPUP_PADDING_X_PX = 20;
const POPUP_PADDING_Y_PX = 30;

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
  const mapRef = useRef<MapRef>(null);
  const [touch] = useState(prefersTouch);
  // deck.gl is needed once there is a route to draw, and then stays: the overlay mounts once and
  // is not torn down when a new trip clears the routes for a moment.
  const [drawsDeck, setDrawsDeck] = useState(routes.length > 0);
  if (!drawsDeck && routes.length > 0) setDrawsDeck(true);
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

  // MapLibre's own floor on zooming out would crop the world's width on a tall phone map; see
  // `constrainCamera`. Asked only once the map exists: its first view is set before that.
  function constrain(lngLat: maplibregl.LngLat, zoom: number) {
    const map = mapRef.current;
    if (!map) return { center: lngLat, zoom };
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const { center, zoom: constrained } = constrainCamera(lngLat, zoom, {
      width,
      height,
      minZoom: map.getMinZoom(),
      maxZoom: map.getMaxZoom(),
    });
    return { center: new maplibregl.LngLat(center.lng, center.lat), zoom: constrained };
  }

  /** Works out where the popup for `dot` fits on the map as it is now. */
  function describe(dot: CheckpointDot): Described | null {
    const map = mapRef.current;
    if (!map) return null;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const popupWidth = Math.min(POPUP_WIDTH_PX, width - 2 * POPUP_EDGE_PX - POPUP_PADDING_X_PX);
    const { x, y } = map.project(dot.position);
    const { anchor, maxHeight } = placePopup({
      point: [x, y],
      size: [popupWidth + POPUP_PADDING_X_PX, POPUP_HEIGHT_PX + POPUP_PADDING_Y_PX],
      area: { width, height, padding },
      offset: POPUP_OFFSET_PX,
    });
    return {
      dot,
      anchor,
      maxHeight: Math.max(0, maxHeight - POPUP_PADDING_Y_PX),
      width: popupWidth,
    };
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

  return (
    <Map
      ref={mapRef}
      mapLib={maplibregl}
      mapStyle={MAP_STYLE}
      initialViewState={INITIAL_VIEW_STATE}
      transformConstrain={constrain}
      style={{ width: '100%', height: '100%', ...insetStyle(padding) }}
      attributionControl={false}
      // Rotating is as in Google Maps: Ctrl-drag (MapLibre's own), Command-drag (see
      // `CommandRotate`), right-drag, a twist of two fingers, and the compass to get back to
      // north. Tilting is of no use on a route map.
      maxPitch={0}
      touchPitch={false}
    >
      <MapStyles />
      <CommandRotate />
      {/* Collapses to an info button on a narrow map; every credit stays one tap away. */}
      <AttributionControl position="bottom-right" customAttribution={WEATHER_ATTRIBUTION} />
      <CollapsedAttribution />
      <NavigationControl position="top-right" />
      <PlacePins origin={origin} destination={destination} />
      <MapFraming origin={origin} destination={destination} routes={paths} insets={padding} />
      {drawsDeck && (
        <Suspense fallback={null}>
          <DeckMapLayers
            routes={routes}
            paths={paths}
            dots={dots}
            names={names}
            blockedRouteIds={blockedRouteIds}
            selectedRouteId={selectedRouteId}
            recommendedRouteId={recommendedRouteId}
            onSelectRoute={onSelectRoute}
            heatmap={heatmap}
            truckTrack={truckTrack}
            insets={padding}
            touch={touch}
            heatmapLayers={heatmapLayers}
            labelLayers={labelLayers}
            truckLayers={truckLayers}
            onHover={handleHover}
            onClick={handleClick}
          />
        </Suspense>
      )}
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
