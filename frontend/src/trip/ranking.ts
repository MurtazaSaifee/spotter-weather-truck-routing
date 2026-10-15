import type { Plan, PlannedRoute } from '../api/plan';

/**
 * `Route 1`, `Route 2`… by the route's rank, so the best route is Route 1 and the cards read in
 * order. The plan lists routes by id (fastest first), which is not the order of the cards.
 */
export function routeLabels(routes: PlannedRoute[]): Record<string, string> {
  return Object.fromEntries(routes.map((route) => [route.id, `Route ${route.rank}`]));
}

/** The routes best first, as the server ranked them. */
export function routesByRank(routes: PlannedRoute[]): PlannedRoute[] {
  return [...routes].sort((a, b) => a.rank - b.rank);
}

/** The route to show first: the recommended one, or the best-ranked when none is recommended. */
export function leadRouteId(plan: Plan): string | null {
  return plan.recommended_route_id ?? routesByRank(plan.routes)[0]?.id ?? null;
}
