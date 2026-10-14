import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import type { Deciding, Notice, PlannedRoute } from '../api/plan';
import {
  formatAverageRisk,
  formatDuration,
  formatInZone,
  formatMiles,
  formatMilesExact,
} from '../trip/format';
import { AVERAGE_RISK_TOLERANCE } from '../trip/ranking';
import { CheckCircleIcon } from './icons';

interface RecommendationProps {
  route: PlannedRoute;
  label: string;
  timeZone: string;
}

/** The route to take, in a line. The cards below carry the numbers. */
export function Recommendation({ route, label, timeZone }: RecommendationProps) {
  return (
    <Paper
      component="section"
      aria-labelledby="recommendation-heading"
      variant="outlined"
      sx={{ p: 2, bgcolor: 'success.light', borderColor: 'success.main', borderWidth: 2 }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'success.dark' }}>
        <CheckCircleIcon aria-hidden fontSize="small" />
        <Typography id="recommendation-heading" component="h2" variant="subtitle2">
          Recommended route
        </Typography>
      </Stack>
      <Typography variant="subtitle1" sx={{ mt: 0.75, fontSize: '1.0625rem' }}>
        {`${label} · ${formatMiles(route.distance_miles)} · ${formatDuration(route.duration_seconds)}`}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Arrives {formatInZone(route.arrival, timeZone)}
      </Typography>
    </Paper>
  );
}

interface WhyThisRouteProps {
  recommended: PlannedRoute;
  alternatives: PlannedRoute[];
  /** Route id to `Route N`. */
  labels: Record<string, string>;
}

/** For each alternative, the first criterion that separated it from the recommendation. */
export function WhyThisRoute({ recommended, alternatives, labels }: WhyThisRouteProps) {
  const label = labels[recommended.id];
  return (
    <Paper component="section" aria-labelledby="why-heading" variant="outlined" sx={{ p: 2 }}>
      <Typography id="why-heading" component="h2" variant="subtitle1" sx={{ mb: 0.5 }}>
        Why this route
      </Typography>
      {alternatives.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {`${label} is the only route found, so there is nothing to compare.`}
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {`${label} is recommended. Routes are compared on Severe miles, then High miles, then average risk, then travel time.`}
          </Typography>
          <Stack component="ul" spacing={1.5} sx={{ m: 0, mt: 1.5, p: 0, listStyle: 'none' }}>
            {alternatives.map((route) => (
              <Box
                component="li"
                key={route.id}
                sx={{ pl: 1.5, borderLeft: 3, borderColor: 'divider' }}
              >
                <Typography component="span" variant="subtitle2" sx={{ display: 'block' }}>
                  {`Against ${labels[route.id]}`}
                </Typography>
                <Typography component="span" variant="body2" color="text.secondary">
                  {route.deciding
                    ? explain(route.deciding, label, labels[route.id])
                    : 'No difference found.'}
                </Typography>
              </Box>
            ))}
          </Stack>
        </>
      )}
    </Paper>
  );
}

/** The deciding criterion as a sentence with both values. */
function explain(deciding: Deciding, winner: string, other: string): string {
  const { criterion, recommended_value: won, alternative_value: lost } = deciding;
  switch (criterion) {
    case 'blocked':
      return `Blocked by No Travel: ${formatMilesExact(lost ?? 0)} mi of ${other} is at No Travel.`;
    case 'severe_miles':
      return `Fewer Severe miles: ${winner} has ${formatMilesExact(won ?? 0)} mi, ${other} has ${formatMilesExact(lost ?? 0)} mi.`;
    case 'high_miles':
      return `Fewer High miles: ${winner} has ${formatMilesExact(won ?? 0)} mi, ${other} has ${formatMilesExact(lost ?? 0)} mi.`;
    case 'average_risk': {
      const otherRisk =
        lost === null
          ? `${other} has no forecast data to average`
          : `${other} is ${formatAverageRisk(lost)}`;
      const lowest = formatAverageRisk(deciding.best_average_risk);
      return (
        `Lower average risk: ${winner} is ${formatAverageRisk(won)}, ${otherRisk}. ` +
        `Routes within ${AVERAGE_RISK_TOLERANCE} of the lowest (${lowest}) count as tied.`
      );
    }
    case 'travel_time':
      return `Shorter travel time: ${winner} takes ${formatDuration(won ?? 0)}, ${other} takes ${formatDuration(lost ?? 0)}.`;
  }
}

/** The warning that replaces the recommendation when every route is blocked. */
export function AllBlockedWarning({ warning }: { warning: Notice }) {
  return (
    <Alert severity="error" variant="filled" sx={{ fontWeight: 600, fontSize: '1rem' }}>
      {warning.message}
    </Alert>
  );
}
