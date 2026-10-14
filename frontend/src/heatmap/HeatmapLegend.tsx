import { Box, Stack, Typography } from '@mui/material';
import { RISK_LEVELS } from '../risk/palette';
import type { HeatmapLayer } from './layer';
import { WEATHER_SCALES } from './scales';

/**
 * What the heatmap's colours mean right now, on one compact line. For risk, the same five
 * bands as the checkpoint dots; for wind, rain and snow, the fixed scale with its units and
 * the value at both ends ("60+" means 60 mph or more). Colour is never alone: every band is
 * named, and the scale has numbers beside it.
 */
export function HeatmapLegend({ layer }: { layer: HeatmapLayer }) {
  return (
    <Box
      role="group"
      aria-label="Heatmap legend"
      sx={{ minWidth: 0, minHeight: 20, display: 'flex', alignItems: 'center' }}
    >
      {layer === 'risk' ? <RiskBands /> : <ScaleBar layer={layer} />}
    </Box>
  );
}

/** The five levels the heatmap draws; No data is left transparent on the map. */
function RiskBands() {
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25 }}
    >
      {RISK_LEVELS.slice(0, 5).map(({ code, label, color }) => (
        <Stack key={code} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, flex: 'none' }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            // A hair smaller in a narrow strip, so the five bands stay on one line.
            sx={{ whiteSpace: 'nowrap', '@container (max-width: 599px)': { fontSize: '0.7rem' } }}
          >
            {label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function ScaleBar({ layer }: { layer: Exclude<HeatmapLayer, 'risk'> }) {
  const { title, unit, stops, labels } = WEATHER_SCALES[layer];
  const [low, , high] = labels;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {`${title} (${unit})`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {low}
      </Typography>
      <Box
        aria-hidden="true"
        sx={{
          flex: 'none',
          width: 96,
          height: 10,
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          background: `linear-gradient(to right, ${stops.join(', ')})`,
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {high}
      </Typography>
    </Stack>
  );
}
