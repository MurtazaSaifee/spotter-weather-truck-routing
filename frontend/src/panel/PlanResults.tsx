import { Alert, CircularProgress, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { RESULTS_ANCHOR } from '../layout/AppShell';
import type { ApiError } from '../api/client';
import type { Plan, SamplingInterval } from '../api/plan';
import { describeWait, type RateLimitWait } from '../api/rateLimit';
import { RiskLegend } from '../risk/RiskLegend';
import { routeLabels, routesByRank } from '../trip/ranking';
import { IntervalToggle } from './IntervalToggle';
import { PlanNotices } from './PlanNotices';
import { AllBlockedWarning, Recommendation, WhyThisRoute } from './Recommendation';
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
      <Stack spacing={2} {...{ [RESULTS_ANCHOR]: '' }}>
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
        <ResultsSkeleton />
      </Stack>
    );
  }
  const alert = waiting || (error && <Alert severity="error">{error.message}</Alert>);
  if (!plan) return alert || null;

  const labels = routeLabels(plan.routes);
  const ranked = routesByRank(plan.routes);
  const recommended = plan.routes.find((route) => route.id === plan.recommended_route_id);

  return (
    <Stack spacing={2} {...{ [RESULTS_ANCHOR]: '' }}>
      {alert}
      {plan.all_blocked_warning && <AllBlockedWarning warning={plan.all_blocked_warning} />}
      {recommended && (
        <>
          <Recommendation
            route={recommended}
            label={labels[recommended.id]}
            timeZone={plan.origin_time_zone}
          />
          <WhyThisRoute
            recommended={recommended}
            alternatives={ranked.filter((route) => route.id !== recommended.id)}
            labels={labels}
          />
        </>
      )}
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
        {ranked.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            label={labels[route.id]}
            routeCount={plan.routes.length}
            recommended={route.id === plan.recommended_route_id}
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

/**
 * Stands where the results will be, with their shapes and heights (a recommendation, then
 * route cards), so the panel does not jump when the plan arrives.
 */
function ResultsSkeleton() {
  return (
    <Stack spacing={2} aria-hidden="true">
      <Skeleton variant="rounded" height={92} sx={{ borderRadius: 3 }} />
      {[0, 1, 2].map((index) => (
        <Paper key={index} variant="outlined" sx={{ p: 2, borderWidth: 2 }}>
          <Skeleton width="40%" />
          <Skeleton width="65%" />
          <Skeleton width="50%" />
        </Paper>
      ))}
    </Stack>
  );
}
