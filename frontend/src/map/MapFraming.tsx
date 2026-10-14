import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { Place } from '../api/places';
import type { RoutePath } from './routeLayers';

// A place is only useful if it is on screen: zoom in on a lone one, or frame both ends.
const SINGLE_PIN_MIN_ZOOM = 8;
const BOTH_PINS_MAX_ZOOM = 9;
const ROUTES_MAX_ZOOM = 12;
const FIT_PADDING_PX = 80;

interface MapFramingProps {
  origin: Place | null;
  destination: Place | null;
  routes: RoutePath[];
}

/**
 * Moves the camera to what the driver is working on: all the routes once there are
 * some, otherwise the chosen places. Must sit inside a `Map`.
 */
export function MapFraming({ origin, destination, routes }: MapFramingProps) {
  const { current: map } = useMap();
  const hasRoutes = routes.length > 0;

  // Each new set of routes is framed once; picking a route does not move the camera.
  useEffect(() => {
    if (!map || routes.length === 0) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const { path } of routes) {
      for (const [lng, lat] of path) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: FIT_PADDING_PX, maxZoom: ROUTES_MAX_ZOOM },
    );
  }, [map, routes]);

  // Before routes exist, follow the pins. Once they do, the routes' own framing wins.
  useEffect(() => {
    if (!map || hasRoutes) return;
    if (origin && destination) {
      map.fitBounds(
        [
          [Math.min(origin.lng, destination.lng), Math.min(origin.lat, destination.lat)],
          [Math.max(origin.lng, destination.lng), Math.max(origin.lat, destination.lat)],
        ],
        { padding: FIT_PADDING_PX, maxZoom: BOTH_PINS_MAX_ZOOM },
      );
      return;
    }
    const only = origin ?? destination;
    if (only) {
      map.easeTo({
        center: [only.lng, only.lat],
        zoom: Math.max(map.getZoom(), SINGLE_PIN_MIN_ZOOM),
      });
    }
  }, [map, origin, destination, hasRoutes]);

  return null;
}
