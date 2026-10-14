import { lazy, Suspense } from 'react';
import type { Place } from '../api/places';
import { MapPlaceholder } from './MapPlaceholder';

// MapLibre and deck.gl are heavy; keep them out of the entry chunk so the
// panel renders before the map bundle arrives.
const TripMap = lazy(() => import('./TripMap'));

interface MapViewProps {
  origin: Place | null;
  destination: Place | null;
}

export function MapView({ origin, destination }: MapViewProps) {
  return (
    <Suspense fallback={<MapPlaceholder />}>
      <TripMap origin={origin} destination={destination} />
    </Suspense>
  );
}
