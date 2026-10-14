import { Box } from '@mui/material';
import { lazy, Suspense } from 'react';
import type { Heatmap } from '../heatmap/payload';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import { MapPlaceholder } from './MapPlaceholder';

// MapLibre and deck.gl are heavy; keep them out of the entry chunk so the
// panel renders before the map bundle arrives.
const TripMap = lazy(() => import('./TripMap'));

interface MapViewProps {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  heatmap: Heatmap | null;
  timeZone: string | null;
  selectedRouteId: string | null;
  /** Drawn thicker and on top; null when no route can be recommended. */
  recommendedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

/** The map, in whatever space the layout gives it. */
export function MapView(props: MapViewProps) {
  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <Suspense fallback={<MapPlaceholder />}>
        <TripMap {...props} />
      </Suspense>
    </Box>
  );
}
