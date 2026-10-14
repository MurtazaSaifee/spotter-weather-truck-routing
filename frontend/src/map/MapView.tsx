import { Box } from '@mui/material';
import { lazy, type ReactNode, Suspense } from 'react';
import type { Heatmap } from '../api/heatmap';
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
  onSelectRoute: (id: string) => void;
  /** Controls laid over the map, such as the forecast slider. */
  overlay?: ReactNode;
}

export function MapView({ overlay, ...props }: MapViewProps) {
  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <Suspense fallback={<MapPlaceholder />}>
        <TripMap {...props} />
      </Suspense>
      {overlay}
    </Box>
  );
}
