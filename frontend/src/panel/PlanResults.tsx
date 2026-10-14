import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import type { ApiError } from '../api/client';
import type { Plan, SamplingInterval } from '../api/plan';
import { describeWait, type RateLimitWait } from '../api/rateLimit';
import { RiskLegend } from '../risk/RiskLegend';
import { IntervalToggle } from './IntervalToggle';
import { PlanNotices } from './PlanNotices';
import { RouteCard } from './RouteCard';
import { WakingUpNotice } from './WakingUpNotice';

interface PlanResultsProps {
  isPlanning: boolean;
  error: ApiError | null;
  /** Set while the plan request waits out a short rate limit before its automatic retry. */
  rateLimitWait: RateLimitWait | null;
  plan: Plan | null;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  onIntervalChange: (interval: SamplingInterval) => void;
}

/**
 * The outcome of pressing Plan: a progress message, the API's error, or the route cards.
 * Planning again with another interval keeps the plan on screen until the new one arrives.
 */
export function PlanResults({
  isPlanning,
  error,
  rateLimitWait,
  plan,
  selectedRouteId,
  onSelectRoute,
  onIntervalChange,
}: PlanResultsProps) {
  // A rate limit that clears by itself: say so and count down to the automatic retry.
  const waiting = rateLimitWait && (
    <Alert severity="info" role="status">
      {describeWait(rateLimitWait)}
    </Alert>
  );
  if (isPlanning && !plan) {
    if (waiting) return waiting;
    return (
      <Stack spacing={1}>
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
        <WakingUpNotice />
      </Stack>
    );
  }
  const alert = waiting || (error && <Alert severity="error">{error.message}</Alert>);
  if (!plan) return alert || null;

  return (
    <Stack spacing={2}>
      {alert}
      <PlanNotices notices={plan.notices} />
      <IntervalToggle
        interval={plan.interval_miles}
        automatic={plan.interval_automatic}
        disabled={isPlanning}
        onChange={onIntervalChange}
      />
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
      <RiskLegend />
    </Stack>
  );
}
