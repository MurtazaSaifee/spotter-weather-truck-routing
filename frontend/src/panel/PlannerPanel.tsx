import { Stack } from '@mui/material';
import type { ApiError } from '../api/client';
import type { Plan, PlanRequest, SamplingInterval } from '../api/plan';
import type { Place } from '../api/places';
import { AppHeader } from './AppHeader';
import { HealthStatus } from './HealthStatus';
import { PlanResults } from './PlanResults';
import { TripForm } from './TripForm';

interface PlannerPanelProps {
  origin: Place | null;
  onOriginChange: (place: Place | null) => void;
  destination: Place | null;
  onDestinationChange: (place: Place | null) => void;
  onPlan: (request: PlanRequest) => void;
  isPlanning: boolean;
  planError: ApiError | null;
  plan: Plan | null;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  onIntervalChange: (interval: SamplingInterval) => void;
}

export function PlannerPanel({
  origin,
  onOriginChange,
  destination,
  onDestinationChange,
  onPlan,
  isPlanning,
  planError,
  plan,
  selectedRouteId,
  onSelectRoute,
  onIntervalChange,
}: PlannerPanelProps) {
  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <AppHeader />
      <TripForm
        origin={origin}
        onOriginChange={onOriginChange}
        destination={destination}
        onDestinationChange={onDestinationChange}
        isPlanning={isPlanning}
        onPlan={onPlan}
      />
      <PlanResults
        isPlanning={isPlanning}
        error={planError}
        plan={plan}
        selectedRouteId={selectedRouteId}
        onSelectRoute={onSelectRoute}
        onIntervalChange={onIntervalChange}
      />
      <HealthStatus />
    </Stack>
  );
}
