import type { Plan } from '../api/plan';
import { formatDuration, formatInZone, formatMiles } from '../trip/format';
import { routeLabels } from '../trip/ranking';

export interface SheetSummary {
  title: string;
  subtitle?: string;
}

/**
 * The two lines the phone's bottom sheet shows while collapsed: the app's name before a trip,
 * then progress, then the recommendation, so the answer is visible with the sheet down.
 */
export function sheetSummary(plan: Plan | null, isPlanning: boolean): SheetSummary {
  if (isPlanning && !plan) return { title: 'Planning your trip', subtitle: 'Comparing routes and forecasts' };
  if (!plan) {
    return { title: 'Weather-Aware Truck Routing', subtitle: 'Plan the safest route for the weather ahead' };
  }
  const recommended = plan.routes.find((route) => route.id === plan.recommended_route_id);
  if (!recommended) {
    return {
      title: plan.all_blocked_warning ? 'Every route is blocked' : 'Routes ready',
      subtitle: plan.all_blocked_warning ? 'Do not travel at this departure time' : undefined,
    };
  }
  return {
    title: `${routeLabels(plan.routes)[recommended.id]} recommended`,
    subtitle: `${formatMiles(recommended.distance_miles)} · ${formatDuration(recommended.duration_seconds)} · arrives ${formatInZone(recommended.arrival, plan.origin_time_zone)}`,
  };
}
