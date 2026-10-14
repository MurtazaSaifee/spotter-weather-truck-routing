import { Box, Button, CircularProgress, Slider, Typography } from '@mui/material';
import { MAX_FORECAST_HOUR, useForecastHour, useForecastHourStore } from './forecastHour';
import { forecastLabel } from './forecastLabel';

export type HeatmapStatus = 'loading' | 'ready' | 'error';

interface HeatmapControlsProps {
  status: HeatmapStatus;
  /** The plan's departure (ISO-8601) and the origin's zone: the slider's clock times. */
  departure: string;
  timeZone: string;
  onRetry: () => void;
}

/**
 * The forecast heatmap's control strip, under the map: "Checking forecasts…"
 * while the heatmap loads (the routes and recommendation never wait for it), the hour slider
 * once it is there, and a retry when it failed.
 */
export function HeatmapControls({ status, departure, timeZone, onRetry }: HeatmapControlsProps) {
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
          <Typography variant="body2">Checking forecasts…</Typography>
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
      {status === 'ready' && <HourSlider departure={departure} timeZone={timeZone} />}
    </Box>
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
