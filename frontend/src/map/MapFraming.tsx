import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { Place } from '../api/places';
import { boundsOfRoutes, CONTINENTAL_US, fitPadding, type Bounds, type Insets } from './framing';
import type { RoutePath } from './routeLayers';

// A place is only useful if it is on screen: zoom in on a lone one, or frame both ends.
const SINGLE_PIN_MIN_ZOOM = 8;
const BOTH_PINS_MAX_ZOOM = 9;
const ROUTES_MAX_ZOOM = 12;
// A whole country on a big screen needs no more than this: it is not a place to read.
const COUNTRY_MAX_ZOOM = 6;
interface MapFramingProps {
  origin: Place | null;
  destination: Place | null;
  routes: RoutePath[];
  /** Parts of the map covered by the layout (a bottom sheet): the fit keeps clear of them. */
  insets?: Insets;
}

interface Target {
  bounds: Bounds;
  maxZoom: number;
}

/**
 * Moves the camera to what the driver is working on: all the routes once there are some,
 * otherwise the chosen places. The fit is made against the map's real size and kept clear of
 * `insets`, and made again when the map is resized or the insets change, until the driver
 * moves the camera themselves. Must sit inside a `Map`.
 */
export function MapFraming({ origin, destination, routes, insets }: MapFramingProps) {
  const { current: map } = useMap();
  const hasRoutes = routes.length > 0;
  const target = useRef<Target | null>(null);
  // Whether the camera is still where the framing put it. A drag or zoom by the driver ends
  // that, and a resize then leaves the camera alone.
  const following = useRef(true);
  const latestInsets = useRef(insets);
  // The insets arrive as an object that changes identity each render; its values are what count.
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets ?? {};

  const fit = (animate: boolean) => {
    if (!map || !target.current) return;
    const { clientWidth, clientHeight } = map.getContainer();
    const padding = fitPadding(clientWidth, clientHeight, latestInsets.current);
    // Before the first layout the map has no size to fit into; the resize that follows fits it.
    if (
      clientWidth - padding.left - padding.right < 1 ||
      clientHeight - padding.top - padding.bottom < 1
    )
      return;
    map.fitBounds(target.current.bounds, {
      padding,
      maxZoom: target.current.maxZoom,
      duration: animate ? 800 : 0,
    });
  };
  const refit = useRef(fit);
  useEffect(() => {
    refit.current = fit;
    latestInsets.current = insets;
  });

  // Each new set of routes is framed once; picking a route does not move the camera.
  useEffect(() => {
    if (!map || routes.length === 0) return;
    const bounds = boundsOfRoutes(routes);
    if (!bounds) return;
    target.current = { bounds, maxZoom: ROUTES_MAX_ZOOM };
    following.current = true;
    refit.current(true);
  }, [map, routes]);

  // Before routes exist, follow the pins. Once they do, the routes' own framing wins.
  useEffect(() => {
    if (!map || hasRoutes) return;
    if (origin && destination) {
      target.current = {
        bounds: [
          [Math.min(origin.lng, destination.lng), Math.min(origin.lat, destination.lat)],
          [Math.max(origin.lng, destination.lng), Math.max(origin.lat, destination.lat)],
        ],
        maxZoom: BOTH_PINS_MAX_ZOOM,
      };
      following.current = true;
      refit.current(true);
      return;
    }
    const only = origin ?? destination;
    if (!only) {
      // Nothing chosen yet: the whole country, clear of whatever covers the map.
      target.current = { bounds: CONTINENTAL_US, maxZoom: COUNTRY_MAX_ZOOM };
      following.current = true;
      refit.current(false);
      return;
    }
    target.current = null;
    map.easeTo({
      center: [only.lng, only.lat],
      zoom: Math.max(map.getZoom(), SINGLE_PIN_MIN_ZOOM),
    });
  }, [map, origin, destination, hasRoutes]);

  // A different layout (a sheet resting at another height) frames the same data differently.
  useEffect(() => {
    if (following.current) refit.current(true);
  }, [top, right, bottom, left]);

  // Resizing the window or the panel changes how much map there is: keep the data in view.
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const onResize = () => {
      if (following.current) refit.current(false);
    };
    // Fitting is the camera's own doing; anything with an original event is the driver's.
    const onUserMove = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) following.current = false;
    };
    raw.on('resize', onResize);
    raw.on('movestart', onUserMove);
    return () => {
      raw.off('resize', onResize);
      raw.off('movestart', onUserMove);
    };
  }, [map]);

  return null;
}
