import { useState } from 'react';
import { ApiError } from './api/client';
import { type Plan, type PlanRequest, type SamplingInterval, usePlanTrip } from './api/plan';
import type { Place } from './api/places';
import { AppShell } from './layout/AppShell';
import { MapView } from './map/MapView';
import { PlannerPanel } from './panel/PlannerPanel';
import { leadRouteId } from './trip/ranking';

export default function App() {
  // The trip's two ends live here because the panel edits them and the map draws them.
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  // The plan on screen, the request it answers and the selected route are shared the same
  // way: cards and map select together. The plan is kept here, not read from the mutation,
  // so it stays on screen while the same trip is planned again with another interval.
  const planTrip = usePlanTrip();
  const [submitted, setSubmitted] = useState<PlanRequest | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const planError = planTrip.error instanceof ApiError ? planTrip.error : null;

  function handlePlan(request: PlanRequest) {
    setSubmitted(request);
    setPlan(null);
    planTrip.mutate(request, {
      onSuccess: (planned) => {
        setPlan(planned);
        setSelectedRouteId(leadRouteId(planned));
      },
    });
  }

  // The same trip with the driver's interval. The server answers from its route cache, and
  // route ids are stable, so the selection stays where it is.
  function handleIntervalChange(interval: SamplingInterval) {
    if (!submitted) return;
    planTrip.mutate({ ...submitted, interval_miles: interval }, { onSuccess: setPlan });
  }

  return (
    <AppShell
      panel={
        <PlannerPanel
          origin={origin}
          onOriginChange={setOrigin}
          destination={destination}
          onDestinationChange={setDestination}
          onPlan={handlePlan}
          isPlanning={planTrip.isPending}
          planError={planError}
          plan={plan}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          onIntervalChange={handleIntervalChange}
        />
      }
      map={
        <MapView
          origin={origin}
          destination={destination}
          routes={plan?.routes ?? []}
          timeZone={plan?.origin_time_zone ?? null}
          selectedRouteId={selectedRouteId}
          recommendedRouteId={plan?.recommended_route_id ?? null}
          onSelectRoute={setSelectedRouteId}
        />
      }
    />
  );
}
