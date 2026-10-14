import { Box } from '@mui/material';
import { lazy, type ReactNode, Suspense } from 'react';
import type { Heatmap } from '../heatmap/payload';
import type { PlannedRoute } from '../api/plan';
import type { Place } from '../api/places';
import type { Insets } from './framing';
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
  /** Parts of the map the layout covers, such as a phone's bottom sheet, in pixels. */
  padding?: Insets;
  /** A strip under the map, such as the forecast slider. */
  controls?: ReactNode;
}

/**
 * The map with a strip of controls beneath it. The strip sits below the map rather than over
 * it: the map's attribution wraps onto several lines in a narrow map, and nothing laid over the
 * map's corners can be sure to stay clear of it.
 */
export function MapView({ controls, ...props }: MapViewProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Suspense fallback={<MapPlaceholder />}>
          <TripMap {...props} />
        </Suspense>
      </Box>
      {controls}
    </Box>
  );
}
