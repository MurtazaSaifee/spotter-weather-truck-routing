import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import type { ApiError } from '../api/client';
import type { Plan, SamplingInterval } from '../api/plan';
import { RiskLegend } from '../risk/RiskLegend';
import { routeLabels, routesByRank } from '../trip/ranking';
import { IntervalToggle } from './IntervalToggle';
import { PlanNotices } from './PlanNotices';
import { AllBlockedWarning, Recommendation, WhyThisRoute } from './Recommendation';
import { RouteCard } from './RouteCard';

interface PlanResultsProps {
  isPlanning: boolean;
  error: ApiError | null;
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
  plan,
  selectedRouteId,
  onSelectRoute,
  onIntervalChange,
}: PlanResultsProps) {
  if (isPlanning && !plan) {
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
  const alert = error && <Alert severity="error">{error.message}</Alert>;
  if (!plan) return alert || null;

  const labels = routeLabels(plan.routes);
  const ranked = routesByRank(plan.routes);
  const recommended = plan.routes.find((route) => route.id === plan.recommended_route_id);

  return (
    <Stack spacing={2}>
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
