import { lazy, Suspense } from 'react';
import { MapPlaceholder } from './MapPlaceholder';

// MapLibre and deck.gl are heavy; keep them out of the entry chunk so the
// panel renders before the map bundle arrives.
const TripMap = lazy(() => import('./TripMap'));

export function MapView() {
  return (
    <Suspense fallback={<MapPlaceholder />}>
      <TripMap />
    </Suspense>
  );
}
