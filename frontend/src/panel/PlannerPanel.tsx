import { Box, Stack } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import type { ApiError } from '../api/client';
import type { Plan, PlanRequest, SamplingInterval } from '../api/plan';
import type { Place } from '../api/places';
import type { RateLimitWait } from '../api/rateLimit';
import { AppHeader } from './AppHeader';
import { PlanResults } from './PlanResults';
import { TripForm } from './TripForm';

// Clipped away, not removed, so a screen reader still finds the page's h1.
const visuallyHiddenBelowMd = (theme: Theme) =>
  ({
    [theme.breakpoints.down('md')]: {
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
    },
  }) as const;

interface PlannerPanelProps {
  origin: Place | null;
  onOriginChange: (place: Place | null) => void;
  destination: Place | null;
  onDestinationChange: (place: Place | null) => void;
  onPlan: (request: PlanRequest) => void;
  isPlanning: boolean;
  planError: ApiError | null;
  planRateLimitWait: RateLimitWait | null;
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
  planRateLimitWait,
  plan,
  selectedRouteId,
  onSelectRoute,
  onIntervalChange,
}: PlannerPanelProps) {
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* The phone sheet's header already names the app; the h1 stays for screen readers. */}
      <Box sx={(theme) => ({ mb: { md: 3 }, ...visuallyHiddenBelowMd(theme) })}>
        <AppHeader />
      </Box>
      <Stack spacing={3}>
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
          rateLimitWait={planRateLimitWait}
          plan={plan}
          selectedRouteId={selectedRouteId}
          onSelectRoute={onSelectRoute}
          onIntervalChange={onIntervalChange}
        />
      </Stack>
    </Box>
  );
}
