import { Stack } from '@mui/material';
import { AppHeader } from './AppHeader';
import { HealthStatus } from './HealthStatus';

export function PlannerPanel() {
  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <AppHeader />
      <HealthStatus />
    </Stack>
  );
}
