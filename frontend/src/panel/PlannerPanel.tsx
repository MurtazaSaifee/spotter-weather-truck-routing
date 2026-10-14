import { Stack } from '@mui/material';
import type { Place } from '../api/places';
import { AppHeader } from './AppHeader';
import { HealthStatus } from './HealthStatus';
import { PlaceField } from './PlaceField';

interface PlannerPanelProps {
  origin: Place | null;
  onOriginChange: (place: Place | null) => void;
  destination: Place | null;
  onDestinationChange: (place: Place | null) => void;
}

export function PlannerPanel({
  origin,
  onOriginChange,
  destination,
  onDestinationChange,
}: PlannerPanelProps) {
  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <AppHeader />
      <Stack spacing={2}>
        <PlaceField label="Origin" value={origin} onChange={onOriginChange} />
        <PlaceField label="Destination" value={destination} onChange={onDestinationChange} />
      </Stack>
      <HealthStatus />
    </Stack>
  );
}
