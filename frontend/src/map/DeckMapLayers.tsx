import type { PickingInfo } from '@deck.gl/core';
import { useTheme } from '@mui/material/styles';
import type { PlannedRoute } from '../api/plan';
import type { Heatmap } from '../heatmap/payload';
import type { TruckTrack } from '../truck/truckTrack';
import type { CheckpointDot } from './checkpointDots';
import { createCheckpointLayers } from './checkpointLayers';
import { DeckGLOverlay } from './DeckGLOverlay';
import type { Insets } from './framing';
import { HeatmapLayers } from './HeatmapLayers';
import { LabelPlacement } from './LabelPlacement';
import type { LayerStore } from './layerStore';
import { createRouteLayers, type RoutePath } from './routeLayers';
import {
  RECOMMENDED_ROUTE_COLOR,
  ROUTE_PICKING_RADIUS_PX,
  TOUCH_PICKING_RADIUS_PX,
} from './routeStyle';
import { TruckMarker } from './TruckMarker';

// Everything on the map that draws with deck.gl. TripMap loads this module lazily, the first time
// there is a plan to draw: until then the map is only its base style and the place pins, and
// deck.gl (most of the map's JavaScript after MapLibre) is not downloaded. It must sit inside
// the `Map`, as the overlay and the layers that feed it need the map's context.

interface DeckMapLayersProps {
  routes: PlannedRoute[];
  paths: RoutePath[];
  dots: CheckpointDot[];
  /** Route ids to the names the cards use (`Route 1`). */
  names: Record<string, string>;
  blockedRouteIds: ReadonlySet<string>;
  selectedRouteId: string | null;
  recommendedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  /** The forecast heatmap over the routes; null until it arrives. */
  heatmap: Heatmap | null;
  truckTrack: TruckTrack | null;
  /** Parts of the map the layout covers; labels stay clear of them. */
  insets: Insets;
  /** Whether the main way of pointing is a finger, which needs bigger pick targets. */
  touch: boolean;
  /** The layer stores that change outside React: see TripMap. */
  heatmapLayers: LayerStore;
  labelLayers: LayerStore;
  truckLayers: LayerStore;
  onHover: (info: PickingInfo) => void;
  onClick: (info: PickingInfo) => void;
}

export default function DeckMapLayers({
  routes,
  paths,
  dots,
  names,
  blockedRouteIds,
  selectedRouteId,
  recommendedRouteId,
  onSelectRoute,
  heatmap,
  truckTrack,
  insets,
  touch,
  heatmapLayers,
  labelLayers,
  truckLayers,
  onHover,
  onClick,
}: DeckMapLayersProps) {
  const theme = useTheme();
  const layers = [
    ...createRouteLayers({
      paths,
      selectedRouteId,
      recommendedRouteId,
      blockedRouteIds,
      onSelectRoute,
      selectedColor: theme.palette.primary.main,
      recommendedColor: RECOMMENDED_ROUTE_COLOR,
      otherColor: theme.palette.grey[500],
    }),
    ...createCheckpointLayers({ dots, selectedRouteId }),
  ];

  return (
    <>
      <HeatmapLayers heatmap={heatmap} underlay={heatmapLayers} />
      <LabelPlacement
        routes={routes}
        paths={paths}
        names={names}
        selectedRouteId={selectedRouteId}
        recommendedRouteId={recommendedRouteId}
        onSelectRoute={onSelectRoute}
        insets={insets}
        layers={labelLayers}
      />
      <TruckMarker track={truckTrack} layers={truckLayers} />
      <DeckGLOverlay
        layers={layers}
        underlay={heatmapLayers}
        labelLayers={labelLayers}
        topLayers={truckLayers}
        pickingRadius={touch ? TOUCH_PICKING_RADIUS_PX : ROUTE_PICKING_RADIUS_PX}
        onHover={onHover}
        onClick={onClick}
      />
    </>
  );
}
