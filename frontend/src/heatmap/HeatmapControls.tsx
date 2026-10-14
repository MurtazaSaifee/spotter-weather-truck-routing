import {
  Box,
  Button,
  CircularProgress,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { PlannedRoute } from '../api/plan';
import { describeWait, type RateLimitWait } from '../api/rateLimit';
import { TruckStatus } from '../truck/TruckStatus';
import { MAX_FORECAST_HOUR, useForecastHour, useForecastHourStore } from './forecastHour';
import { forecastLabel } from './forecastLabel';
import { HeatmapLegend } from './HeatmapLegend';
import { HEATMAP_LAYERS, type HeatmapLayer } from './layer';

export type HeatmapStatus = 'loading' | 'ready' | 'error';

interface HeatmapControlsProps {
  status: HeatmapStatus;
  /** Set while the heatmap request waits out a short rate limit before its automatic retry. */
  rateLimitWait: RateLimitWait | null;
  /** The plan's departure (ISO-8601) and the origin's zone: the slider's clock times. */
  departure: string;
  timeZone: string;
  layer: HeatmapLayer;
  onLayerChange: (layer: HeatmapLayer) => void;
  /** The selected route, whose truck is described beneath the slider. */
  route: PlannedRoute | null;
  onRetry: () => void;
}

/**
 * The forecast heatmap's control strip, under the map: "Checking forecasts…"
 * while the heatmap loads (the routes and recommendation never wait for it), then the layer
 * toggle with its legend and the hour slider, and a retry when it failed.
 */
export function HeatmapControls({
  status,
  rateLimitWait,
  departure,
  timeZone,
  layer,
  onLayerChange,
  route,
  onRetry,
}: HeatmapControlsProps) {
  return (
    <Box
      sx={{
        flex: 'none',
        px: 2,
        py: 1,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      {status === 'loading' && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} thickness={5} aria-hidden />
          <Typography variant="body2">
            {rateLimitWait ? describeWait(rateLimitWait) : 'Checking forecasts…'}
          </Typography>
        </Box>
      )}
      {status === 'error' && (
        <Box
          role="alert"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
        >
          <Typography variant="body2">The forecast heatmap could not be loaded.</Typography>
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        </Box>
      )}
      {status === 'ready' && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 2,
              rowGap: 1,
              mb: 0.5,
            }}
          >
            <LayerToggle layer={layer} onChange={onLayerChange} />
            <HeatmapLegend layer={layer} />
          </Box>
          <HourSlider departure={departure} timeZone={timeZone} />
          <TruckStatus route={route} />
        </>
      )}
    </Box>
  );
}

function LayerToggle({
  layer,
  onChange,
}: {
  layer: HeatmapLayer;
  onChange: (layer: HeatmapLayer) => void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      color="primary"
      aria-label="Heatmap layer"
      value={layer}
      // Pressing the one in use deselects it: stay put instead.
      onChange={(_, next: HeatmapLayer | null) => {
        if (next !== null) onChange(next);
      }}
    >
      {HEATMAP_LAYERS.map(({ layer: value, label }) => (
        <ToggleButton key={value} value={value} sx={{ px: 1.5, py: 0.25 }}>
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function HourSlider({ departure, timeZone }: { departure: string; timeZone: string }) {
  const store = useForecastHourStore();
  const hour = useForecastHour();
  const label = forecastLabel(departure, hour, timeZone);
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 500 }} aria-live="off">
        {label}
      </Typography>
      <Slider
        aria-label="Hours after departure"
        min={0}
        max={MAX_FORECAST_HOUR}
        step={1}
        value={hour}
        getAriaValueText={() => label}
        onChange={(_, value) => store.set(typeof value === 'number' ? value : (value[0] ?? 0))}
        size="small"
      />
    </Box>
  );
}
