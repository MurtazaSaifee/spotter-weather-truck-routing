import { Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { createSvgIcon } from '@mui/material/utils';
import { useHealth } from '../api/health';
import { WakingUpNotice } from './WakingUpNotice';

// Material "check_circle" and "error" glyphs, inlined to avoid pulling in the
// whole icon package for two shapes.
const CheckCircleIcon = createSvgIcon(
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />,
  'CheckCircle',
);
const ErrorIcon = createSvgIcon(
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />,
  'Error',
);

export function HealthStatus() {
  const { isSuccess, isFetching, error, refetch } = useHealth();
  // After a failure, Retry refetches while the query still holds the error,
  // so "checking" must win over "error" until the refetch settles.
  const isChecking = !isSuccess && isFetching;
  const isFailed = !isSuccess && !isChecking;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography component="h2" variant="subtitle2" color="text.secondary" gutterBottom>
        API status
      </Typography>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }}
      >
        {/* Always mounted so assistive tech announces each state change. */}
        <Stack
          role="status"
          aria-live="polite"
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center' }}
        >
          {isChecking && <CircularProgress size={18} thickness={5} aria-hidden="true" />}
          {isSuccess && <CheckCircleIcon color="success" fontSize="small" />}
          {isFailed && <ErrorIcon color="error" fontSize="small" />}
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {isChecking && 'Checking API…'}
            {isSuccess && 'API healthy'}
            {isFailed && error?.message}
          </Typography>
        </Stack>
        {isFailed && (
          <Button size="small" variant="outlined" onClick={() => void refetch()}>
            Retry
          </Button>
        )}
      </Stack>
      {/* The page's first request: a sleeping server answers it slowly. */}
      {isChecking && <WakingUpNotice />}
    </Paper>
  );
}
