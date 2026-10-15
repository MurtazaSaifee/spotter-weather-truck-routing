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

export type HeatmapStatus = 'idle' | 'loading' | 'ready' | 'error';

interface HeatmapControlsProps {
  /** `idle` is before any trip is planned: nothing is rendered. */
  status: HeatmapStatus;
  /** Set while the heatmap request waits out a short rate limit before its automatic retry. */
  rateLimitWait: RateLimitWait | null;
  /** The plan's departure (ISO-8601) and the origin's zone: the slider's clock times. */
  departure: string | null;
  timeZone: string | null;
  layer: HeatmapLayer;
  onLayerChange: (layer: HeatmapLayer) => void;
  /** The selected route, whose truck is described beside the slider. */
  route: PlannedRoute | null;
  onRetry: () => void;
}

// What the strip needs at its two widths; it reserves that in every state once a trip is
// planned, so the map above never changes size when the heatmap arrives.
// Past MID the slider's row fits on one line; past WIDE the toggle and legend do too.
const MID = '@container (min-width: 540px)';
const WIDE = '@container (min-width: 600px)';

/**
 * The forecast heatmap's controls. Desktop: a compact strip under the map. Phone: a card over
 * the map's top edge. Either way it shows "Checking forecasts…" while the heatmap loads (the
 * routes and recommendation never wait for it), then the layer toggle with its legend and the
 * hour slider with the truck's status, and a retry when it failed.
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
  if (status === 'idle') return null;
  const ready = status === 'ready' && departure !== null && timeZone !== null;
  return (
    <Box
      component="section"
      aria-label="Forecast controls"
      // The strip's own width, not the window's, decides how it lays out.
      sx={{ containerType: 'inline-size' }}
    >
      <Box
        sx={{
          '--strip-min': '152px',
          [MID]: { '--strip-min': '120px' },
          [WIDE]: { '--strip-min': '100px' },
          bgcolor: 'background.paper',
          px: { xs: 1.5, md: 2 },
          py: { xs: 1, md: 1.5 },
          border: { xs: 1, md: 0 },
          borderTop: { md: 1 },
          borderColor: 'divider',
          borderRadius: { xs: 3, md: 0 },
          boxShadow: { xs: '0 2px 12px rgba(22, 27, 38, 0.18)', md: 'none' },
          minHeight: { md: 'var(--strip-min)' },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: { xs: 0.5, md: 1 },
        }}
      >
        {status === 'loading' && (
          <Box
            role="status"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}
          >
            <CircularProgress size={18} thickness={5} aria-hidden />
            <Typography variant="body2">
              {rateLimitWait ? describeWait(rateLimitWait) : 'Checking forecasts…'}
            </Typography>
          </Box>
        )}
        {status === 'error' && (
          <Box
            role="alert"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}
          >
            <Typography variant="body2">The forecast heatmap could not be loaded.</Typography>
            <Button size="small" variant="outlined" onClick={onRetry}>
              Retry
            </Button>
          </Box>
        )}
        {ready && (
          <>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                [WIDE]: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                },
              }}
            >
              <LayerToggle layer={layer} onChange={onLayerChange} />
              <HeatmapLegend layer={layer} />
            </Box>
            <Box
              sx={{
                display: 'grid',
                alignItems: 'center',
                columnGap: 2,
                gridTemplateColumns: 'minmax(0, 1fr)',
                gridTemplateAreas: '"label" "status" "slider"',
                [MID]: {
                  gridTemplateColumns: '200px minmax(120px, 1fr) 150px',
                  gridTemplateAreas: '"label slider status"',
                },
                [WIDE]: { gridTemplateColumns: '200px minmax(120px, 1fr) 176px' },
              }}
            >
              <HourSlider departure={departure} timeZone={timeZone} />
              <Box sx={{ gridArea: 'status', minWidth: 0 }}>
                <TruckStatus route={route} />
              </Box>
            </Box>
          </>
        )}
      </Box>
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
      sx={{
        flex: 'none',
        // Narrow: the four buttons share the strip, each a thumb wide.
        '& .MuiToggleButton-root': {
          flex: 1,
          px: 1.5,
          py: 0.25,
          [WIDE]: { flex: 'none', minWidth: 56 },
        },
      }}
    >
      {HEATMAP_LAYERS.map(({ layer: value, label }) => (
        <ToggleButton key={value} value={value}>
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function HourSlider({ departure, timeZone }: { departure: string; timeZone: string }) {
  const store = useForecastHourStore();
  const hour = useForecastHour();
  const { clock, offset } = forecastLabel(departure, hour, timeZone);
  return (
    <>
      <Typography
        variant="body2"
        noWrap
        // The clock time is never cut; the offset beside it gives way first. Both columns are
        // wide enough for the longest: `Wed 12:00 PM MDT` with `Departure`.
        sx={{
          gridArea: 'label',
          display: 'flex',
          alignItems: 'baseline',
          gap: 0.75,
          minWidth: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
        aria-live="off"
      >
        <Box component="span" sx={{ flex: 'none', fontWeight: 600 }}>
          {clock}
        </Box>
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'text.secondary',
            fontSize: '0.75rem',
          }}
        >
          {offset}
        </Box>
      </Typography>
      <Slider
        aria-label="Hours after departure"
        min={0}
        max={MAX_FORECAST_HOUR}
        step={1}
        value={hour}
        getAriaValueText={() => `${clock}, ${offset}`}
        onChange={(_, value) => store.set(typeof value === 'number' ? value : (value[0] ?? 0))}
        size="small"
        sx={{
          gridArea: 'slider',
          // 44 px tall on a phone so a thumb can find it; slimmer where a pointer does the work.
          py: { xs: 2, md: 1.25 },
          width: 'calc(100% - 20px)',
          mx: '10px',
          '& .MuiSlider-thumb': {
            width: { xs: 22, md: 16 },
            height: { xs: 22, md: 16 },
            '&::after': { inset: { xs: -11, md: -8 } },
          },
        }}
      />
    </>
  );
}
