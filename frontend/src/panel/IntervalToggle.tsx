import { Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { SAMPLING_INTERVALS, type SamplingInterval } from '../api/plan';

interface IntervalToggleProps {
  /** The interval the plan on screen was made with. */
  interval: SamplingInterval;
  /** True when the server chose it from the trip's length. */
  automatic: boolean;
  /** True while the trip is planned again with another interval. */
  disabled: boolean;
  onChange: (interval: SamplingInterval) => void;
}

/** The distance between checkpoints: the server's pick, which the driver can override. */
export function IntervalToggle({ interval, automatic, disabled, onChange }: IntervalToggleProps) {
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography id="interval-label" variant="subtitle2">
          Checkpoint interval
        </Typography>
        {automatic && <Chip label="Auto" size="small" color="primary" variant="outlined" />}
      </Stack>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        color="primary"
        aria-labelledby="interval-label"
        disabled={disabled}
        value={interval}
        // Pressing the one in use deselects it: stay put instead of planning again.
        onChange={(_, next: SamplingInterval | null) => {
          if (next !== null) onChange(next);
        }}
      >
        {SAMPLING_INTERVALS.map((miles) => (
          <ToggleButton key={miles} value={miles}>
            {miles} mi
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
