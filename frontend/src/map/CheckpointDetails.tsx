import { Box, Typography } from '@mui/material';
import type { Checkpoint, CheckpointWeather } from '../api/plan';
import { formatInZone, formatMilesExact } from '../trip/format';

interface CheckpointDetailsProps {
  checkpoint: Checkpoint;
  routeLabel: string;
  /** The origin's zone: the ETA is shown, and labelled, in it. */
  timeZone: string;
}

/** What the map says about a checkpoint when the driver hovers or taps it. */
export function CheckpointDetails({ checkpoint, routeLabel, timeZone }: CheckpointDetailsProps) {
  return (
    <Box role="tooltip" sx={{ minWidth: 180 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {routeLabel}
      </Typography>
      <Typography variant="subtitle2">Mile {formatMilesExact(checkpoint.mile)}</Typography>
      <Typography variant="body2">ETA {formatInZone(checkpoint.eta, timeZone)}</Typography>
      <Typography variant="body2" color="text.secondary">
        Covers {formatMilesExact(checkpoint.covered_miles)} mi
      </Typography>
      <Forecast weather={checkpoint.weather} />
    </Box>
  );
}

/** The forecast at the ETA, or No data: a checkpoint without one is never shown as fine. */
function Forecast({ weather }: { weather: CheckpointWeather | null }) {
  if (!weather) {
    return (
      <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
        No data
      </Typography>
    );
  }
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="body2">Wind {formatNumber(weather.wind_mph, 1)} mph</Typography>
      <Typography variant="body2">
        Gusts {weather.gust_mph === null ? 'no data' : `${formatNumber(weather.gust_mph, 1)} mph`}
      </Typography>
      <Typography variant="body2">Rain rate {formatNumber(weather.rain_in_hr, 3)} in/hr</Typography>
      <Typography variant="body2">
        Snowfall rate {formatNumber(weather.snow_in_hr, 3)} in/hr
      </Typography>
    </Box>
  );
}

/** At most `digits` decimals, without a pointless `.0`: `9` and `0.034`. */
function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}
