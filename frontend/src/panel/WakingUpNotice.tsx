import { Typography } from '@mui/material';
import { useEffect, useState } from 'react';

/** The server sleeps when idle; waking it takes a few seconds. */
export const SLOW_RESPONSE_MS = 3000;

/**
 * Mount this while a request is waiting: once the wait passes three seconds it explains that
 * the server may be waking up. Unmounting (the request answered) resets it.
 */
export function WakingUpNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SLOW_RESPONSE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <Typography variant="body2" color="text.secondary">
      Waking up the server… the first request after a quiet spell can take a few seconds.
    </Typography>
  );
}
