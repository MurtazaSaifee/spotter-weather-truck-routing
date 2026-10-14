import { Box, Typography } from '@mui/material';
import type { Checkpoint } from '../api/plan';
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
    </Box>
  );
}
