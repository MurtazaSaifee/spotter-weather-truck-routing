import { useState } from 'react';
import type { Checkpoint, PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { CheckpointDetails } from '../map/CheckpointDetails';

interface TripMapStubProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  timeZone: string | null;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

/**
 * Stands in for the real TripMap in page-level tests: WebGL is unavailable in
 * jsdom and the real canvas is verified manually. It mirrors the accessible name
 * MapLibre gives its canvas and exposes what the page handed the map, so tests
 * can assert on which pins, routes and checkpoints would be drawn, select a route
 * the way clicking its line would, and read a checkpoint's details the way pointing
 * at its dot would. Page tests install it with
 * `vi.mock('../map/TripMap', () => import('./tripMapStub'))`.
 */
export default function TripMapStub({
  origin,
  destination,
  routes,
  timeZone,
  selectedRouteId,
  onSelectRoute,
}: TripMapStubProps) {
  const [described, setDescribed] = useState<{ route: number; checkpoint: Checkpoint } | null>(
    null,
  );
  return (
    <div role="region" aria-label="Map">
      {origin && <StubPin kind="Origin" place={origin} />}
      {destination && <StubPin kind="Destination" place={destination} />}
      {routes.map((route, index) => (
        <div key={route.id}>
          <button
            type="button"
            aria-label={`Route ${index + 1} on map`}
            aria-pressed={route.id === selectedRouteId}
            onClick={() => onSelectRoute(route.id)}
          >
            {route.geometry}
          </button>
          {route.checkpoints.map((checkpoint) => (
            <button
              key={checkpoint.mile}
              type="button"
              aria-label={`Route ${index + 1} checkpoint at mile ${checkpoint.mile}`}
              onClick={() => setDescribed({ route: index + 1, checkpoint })}
            />
          ))}
        </div>
      ))}
      {described && timeZone && (
        <CheckpointDetails
          checkpoint={described.checkpoint}
          routeLabel={`Route ${described.route}`}
          timeZone={timeZone}
        />
      )}
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
