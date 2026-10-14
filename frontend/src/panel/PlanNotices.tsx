import { Alert, Stack } from '@mui/material';
import type { Notice } from '../api/plan';

/** The plan's plan-level messages, e.g. that fewer than three routes exist. */
export function PlanNotices({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <Stack spacing={1}>
      {notices.map((notice) => (
        <Alert key={notice.code} severity="info">
          {notice.message}
        </Alert>
      ))}
    </Stack>
  );
}
