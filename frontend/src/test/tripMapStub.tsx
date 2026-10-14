import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';

interface TripMapStubProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

/**
 * Stands in for the real TripMap in page-level tests: WebGL is unavailable in
 * jsdom and the real canvas is verified manually. It mirrors the accessible name
 * MapLibre gives its canvas and exposes what the page handed the map, so tests
 * can assert on which pins and routes would be drawn, and select a route the way
 * clicking its line would. Page tests install it with
 * `vi.mock('../map/TripMap', () => import('./tripMapStub'))`.
 */
export default function TripMapStub({
  origin,
  destination,
  routes,
  selectedRouteId,
  onSelectRoute,
}: TripMapStubProps) {
  return (
    <div role="region" aria-label="Map">
      {origin && <StubPin kind="Origin" place={origin} />}
      {destination && <StubPin kind="Destination" place={destination} />}
      {routes.map((route, index) => (
        <button
          key={route.id}
          type="button"
          aria-label={`Route ${index + 1} on map`}
          aria-pressed={route.id === selectedRouteId}
          onClick={() => onSelectRoute(route.id)}
        >
          {route.geometry}
        </button>
      ))}
    </div>
  );
}

function StubPin({ kind, place }: { kind: string; place: Place }) {
  return (
    <div role="img" aria-label={`${kind} pin`}>
      {`${place.label} @ ${place.lat},${place.lng} (${place.time_zone})`}
    </div>
  );
}
