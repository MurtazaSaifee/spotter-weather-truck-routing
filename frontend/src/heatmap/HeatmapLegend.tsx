import { Box, Stack, Typography } from '@mui/material';
import { RISK_LEVELS } from '../risk/palette';
import type { HeatmapLayer } from './layer';
import { WEATHER_SCALES } from './scales';

/**
 * What the heatmap's colours mean right now. For risk, the same five bands as the checkpoint
 * dots; for wind, rain and snow, the fixed scale with its units and the value of its top
 * colour ("60+" means 60 mph or more). Colour is never alone: every band is named, and the
 * scale has numbers under it.
 */
export function HeatmapLegend({ layer }: { layer: HeatmapLayer }) {
  return (
    <Box role="group" aria-label="Heatmap legend" sx={{ minWidth: 0 }}>
      {layer === 'risk' ? <RiskBands /> : <ScaleBar layer={layer} />}
    </Box>
  );
}

/** The five levels the heatmap draws; No data is left transparent on the map. */
function RiskBands() {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }} useFlexGap>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        Combined risk
      </Typography>
      {RISK_LEVELS.slice(0, 5).map(({ code, label, color }) => (
        <Stack key={code} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, flex: 'none' }}
          />
          <Typography variant="caption">{label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function ScaleBar({ layer }: { layer: Exclude<HeatmapLayer, 'risk'> }) {
  const { title, unit, stops, labels } = WEATHER_SCALES[layer];
  return (
    <Stack spacing={0.25} sx={{ width: { xs: '100%', sm: 220 } }}>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {`${title} (${unit})`}
      </Typography>
      <Box
        aria-hidden="true"
        sx={{
          height: 10,
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          background: `linear-gradient(to right, ${stops.join(', ')})`,
        }}
      />
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        {labels.map((label) => (
          <Typography key={label} variant="caption" color="text.secondary">
            {label}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
