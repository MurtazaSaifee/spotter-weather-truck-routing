import { useMemo, useState } from 'react';
import { ApiError } from './api/client';
import { type HeatmapRequest, useHeatmap } from './api/heatmap';
import { type Plan, type PlanRequest, type SamplingInterval, usePlanTrip } from './api/plan';
import type { Place } from './api/places';
import { createForecastHourStore, ForecastHourContext } from './heatmap/forecastHour';
import { HeatmapControls, type HeatmapStatus } from './heatmap/HeatmapControls';
import { DEFAULT_HEATMAP_LAYER, type HeatmapLayer, HeatmapLayerContext } from './heatmap/layer';
import { AppShell } from './layout/AppShell';
import { MapView } from './map/MapView';
import { PlannerPanel } from './panel/PlannerPanel';

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
  // The hour on the forecast slider. It is a store rather than state: the map layers follow
  // it directly, so a slider tick re-renders nothing above the slider's own label.
  const [forecastHour] = useState(createForecastHourStore);
  // What the heatmap shows: combined risk, or the wind, rain or snow behind it. It is kept
  // across trips, like the hour is across layers.
  const [heatmapLayer, setHeatmapLayer] = useState<HeatmapLayer>(DEFAULT_HEATMAP_LAYER);

  // The heatmap of the routes on screen, fetched once per trip. Planning the same trip with
  // another interval leaves the geometries, departure and load as they were: the same query,
  // so the heatmap stays. It never holds the routes or the recommendation back.
  const heatmapRequest = useMemo<HeatmapRequest | null>(
    () =>
      plan && submitted
        ? {
            geometries: plan.routes.map((route) => route.geometry),
            departure: plan.departure,
            load_weight_lb: submitted.load_weight_lb,
          }
        : null,
    [plan, submitted],
  );
  const heatmap = useHeatmap(heatmapRequest);
  const heatmapStatus: HeatmapStatus = heatmap.isError
    ? 'error'
    : heatmap.data
      ? 'ready'
      : 'loading';

  const planError = planTrip.error instanceof ApiError ? planTrip.error : null;

  function handlePlan(request: PlanRequest) {
    setSubmitted(request);
    setPlan(null);
    forecastHour.set(0);
    planTrip.mutate(request, {
      onSuccess: (planned) => {
        setPlan(planned);
        setSelectedRouteId(planned.routes[0]?.id ?? null);
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
    <ForecastHourContext.Provider value={forecastHour}>
      <HeatmapLayerContext.Provider value={heatmapLayer}>
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
              planRateLimitWait={planTrip.rateLimitWait}
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
              heatmap={heatmap.data ?? null}
              timeZone={plan?.origin_time_zone ?? null}
              selectedRouteId={selectedRouteId}
              onSelectRoute={setSelectedRouteId}
              controls={
                plan ? (
                  <HeatmapControls
                    status={heatmapStatus}
                    rateLimitWait={heatmap.rateLimitWait}
                    departure={plan.departure}
                    timeZone={plan.origin_time_zone}
                    layer={heatmapLayer}
                    onLayerChange={setHeatmapLayer}
                    route={plan.routes.find(({ id }) => id === selectedRouteId) ?? null}
                    onRetry={() => void heatmap.refetch()}
                  />
                ) : null
              }
            />
          }
        />
      </HeatmapLayerContext.Provider>
    </ForecastHourContext.Provider>
  );
}
