import { useState } from 'react';
import { ApiError } from './api/client';
import { type PlanRequest, usePlanTrip } from './api/plan';
import type { Place } from './api/places';
import { AppShell } from './layout/AppShell';
import { MapView } from './map/MapView';
import { PlannerPanel } from './panel/PlannerPanel';

export default function App() {
  // The trip's two ends live here because the panel edits them and the map draws them.
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  // The plan and the selected route are shared the same way: cards and map select together.
  const planTrip = usePlanTrip();
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const plan = planTrip.data ?? null;
  const planError = planTrip.error instanceof ApiError ? planTrip.error : null;

  function handlePlan(request: PlanRequest) {
    planTrip.mutate(request, {
      onSuccess: (planned) => setSelectedRouteId(planned.routes[0]?.id ?? null),
    });
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
        />
      }
      map={
        <MapView
          origin={origin}
          destination={destination}
          routes={plan?.routes ?? []}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
        />
      }
    />
  );
}
