import { Alert } from '@mui/material';
import type { Notice } from '../api/plan';

/** The warning shown when every route is blocked. */
export function AllBlockedWarning({ warning }: { warning: Notice }) {
  return (
    <Alert severity="error" variant="filled" sx={{ fontWeight: 600, fontSize: '1rem' }}>
      {warning.message}
    </Alert>
  );
}
