import { useEffect, useState } from 'react';

const REFRESH_MS = 30_000;

/** The current time in milliseconds, refreshed every 30 seconds so time windows keep moving. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}
