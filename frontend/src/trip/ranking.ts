import type { Plan, PlannedRoute } from '../api/plan';

/**
 * Average risks closer than this to the lowest one count as tied, and travel time decides.
 * It mirrors the backend's `AVERAGE_RISK_TOLERANCE`, which does the ranking; it is only used to
 * say so in the explanation.
 */
export const AVERAGE_RISK_TOLERANCE = 0.25;

/** `Route 1`, `Route 2`… by the route's place in the plan, which follows its id (fastest first). */
export function routeLabels(routes: PlannedRoute[]): Record<string, string> {
  return Object.fromEntries(routes.map((route, index) => [route.id, `Route ${index + 1}`]));
}

/** The routes best first, as the server ranked them. */
export function routesByRank(routes: PlannedRoute[]): PlannedRoute[] {
  return [...routes].sort((a, b) => a.rank - b.rank);
}

/** The route to show first: the recommended one, or the best-ranked when none is recommended. */
export function leadRouteId(plan: Plan): string | null {
  return plan.recommended_route_id ?? routesByRank(plan.routes)[0]?.id ?? null;
}
