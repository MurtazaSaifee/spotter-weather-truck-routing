import { Box, Typography } from '@mui/material';
import type {
  Checkpoint,
  CheckpointRisk,
  CheckpointWeather,
  ConditionName,
  RiskLevel,
} from '../api/plan';
import { riskStyle } from '../risk/palette';
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
    <Box role="tooltip" sx={{ minWidth: 200 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {routeLabel}
      </Typography>
      <Typography variant="subtitle2">Mile {formatMilesExact(checkpoint.mile)}</Typography>
      <Typography variant="body2">ETA {formatInZone(checkpoint.eta, timeZone)}</Typography>
      <Typography variant="body2" color="text.secondary">
        Covers {formatMilesExact(checkpoint.covered_miles)} mi
      </Typography>
      <Risk risk={checkpoint.risk} />
      <Forecast weather={checkpoint.weather} risk={checkpoint.risk} />
    </Box>
  );
}

const CONDITION_WORDS: Record<ConditionName, string> = {
  wind: 'wind',
  rain: 'rain',
  snow: 'snow',
};

const words = (names: ConditionName[], joiner: string) =>
  names.map((name) => CONDITION_WORDS[name]).join(joiner);

/** The level with its colour and name, then why: what drove it, what stacked, what gusts add. */
function Risk({ risk }: { risk: CheckpointRisk }) {
  const { label, color } = riskStyle(risk.level);
  return (
    <Box sx={{ mt: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          aria-hidden="true"
          sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, flexShrink: 0 }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Risk: {label}
        </Typography>
      </Box>
      {risk.driving.length > 0 && (
        <Typography variant="body2">Driven by {words(risk.driving, ' and ')}</Typography>
      )}
      {risk.wind_raised_by_load && (
        <Typography variant="body2">Raised by the load weight</Typography>
      )}
      {risk.combined.length > 0 && (
        <Typography variant="body2">Combined conditions: {words(risk.combined, ' + ')}</Typography>
      )}
      {risk.gust_warning && (
        <Typography variant="body2">
          Gusts alone: {formatNumber(risk.gust_warning.gust_mph, 1)} mph would be{' '}
          {riskStyle(risk.gust_warning.level).label}
        </Typography>
      )}
    </Box>
  );
}

/** The forecast at the ETA, or No data: a checkpoint without one is never shown as fine. */
function Forecast({
  weather,
  risk,
}: {
  weather: CheckpointWeather | null;
  risk: CheckpointRisk;
}) {
  if (!weather) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="body2">
        Wind {formatNumber(weather.wind_mph, 1)} mph{levelOf(risk.conditions.wind)}
      </Typography>
      <Typography variant="body2">
        Gusts {weather.gust_mph === null ? 'no data' : `${formatNumber(weather.gust_mph, 1)} mph`}
      </Typography>
      <Typography variant="body2">
        Rain rate {formatNumber(weather.rain_in_hr, 3)} in/hr{levelOf(risk.conditions.rain)}
      </Typography>
      <Typography variant="body2">
        Snowfall rate {formatNumber(weather.snow_in_hr, 3)} in/hr{levelOf(risk.conditions.snow)}
      </Typography>
    </Box>
  );
}

/** ` · Moderate`: a condition's own level, beside its value. */
function levelOf(level: RiskLevel | null): string {
  return level ? ` · ${riskStyle(level).label}` : '';
}

/** At most `digits` decimals, without a pointless `.0`: `9` and `0.034`. */
function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}
