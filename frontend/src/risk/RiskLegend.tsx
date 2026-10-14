import { Box, Stack, Typography } from '@mui/material';
import { RISK_LEVELS } from './palette';

/** What each checkpoint colour means; every swatch is named, so colour is never alone. */
export function RiskLegend() {
  return (
    <Box component="section" aria-labelledby="risk-legend-heading">
      <Typography id="risk-legend-heading" component="h2" variant="subtitle1" sx={{ mb: 1 }}>
        Risk legend
      </Typography>
      <Stack
        component="ul"
        direction="row"
        useFlexGap
        sx={{ flexWrap: 'wrap', gap: 1.5, listStyle: 'none', m: 0, p: 0 }}
      >
        {RISK_LEVELS.map(({ code, label, color }) => (
          <Stack
            key={code}
            component="li"
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center' }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: color,
                border: 1,
                borderColor: 'common.white',
                boxShadow: (theme) => `0 0 0 1px ${theme.palette.divider}`,
              }}
            />
            <Typography variant="body2">{label}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
