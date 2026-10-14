import { Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useHealth } from '../api/health';
import { CheckCircleIcon, ErrorIcon } from './icons';
import { WakingUpNotice } from './WakingUpNotice';

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
