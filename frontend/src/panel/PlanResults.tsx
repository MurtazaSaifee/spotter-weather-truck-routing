import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import type { ApiError } from '../api/client';
import type { Plan } from '../api/plan';
import { PlanNotices } from './PlanNotices';
import { RouteCard } from './RouteCard';

interface PlanResultsProps {
  isPlanning: boolean;
  error: ApiError | null;
  plan: Plan | null;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
}

/** The outcome of pressing Plan: a progress message, the API's error, or the route cards. */
export function PlanResults({
  isPlanning,
  error,
  plan,
  selectedRouteId,
  onSelectRoute,
}: PlanResultsProps) {
  if (isPlanning) {
    return (
      <Stack
        role="status"
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', color: 'text.secondary' }}
      >
        <CircularProgress size={18} thickness={5} aria-hidden="true" />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Finding routes…
        </Typography>
      </Stack>
    );
  }
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!plan) return null;

  return (
    <Stack spacing={2}>
      <PlanNotices notices={plan.notices} />
      <Stack component="section" aria-labelledby="routes-heading" spacing={1.5}>
        <Typography id="routes-heading" component="h2" variant="subtitle1">
          Routes
        </Typography>
        {plan.routes.map((route, index) => (
          <RouteCard
            key={route.id}
            route={route}
            label={`Route ${index + 1}`}
            timeZone={plan.origin_time_zone}
            selected={route.id === selectedRouteId}
            onSelect={() => onSelectRoute(route.id)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
