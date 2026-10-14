import { ApiError } from './client';

/** A rate limit the app is waiting out before it asks again. */
export interface RateLimitWait {
  /** Whole seconds left. */
  seconds: number;
  /** The API's own message about the limit. */
  message: string;
}

export function describeWait({ message, seconds }: RateLimitWait): string {
  return `${message} Trying again in ${seconds} s…`;
}

/** Calls `onTick` with the seconds left, from `seconds` down to 1, and resolves at 0. */
function countDown(
  seconds: number,
  onTick: (secondsLeft: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let left = seconds;
    onTick(left);
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        onTick(left);
        return;
      }
      clearInterval(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 1000);
    function onAbort() {
      clearInterval(timer);
      reject(new DOMException('The wait was cancelled.', 'AbortError'));
    }
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `attempt`; if the API says it is rate-limited for a short while, waits that long
 * (reporting the countdown through `onWait`) and runs it one more time. A second failure, or
 * any other error, is thrown as it is.
 */
export async function retryOnceAfterRateLimit<T>(
  attempt: () => Promise<T>,
  onWait: (wait: RateLimitWait | null) => void,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    const seconds = error instanceof ApiError ? error.retryAfterSeconds : null;
    if (!(error instanceof ApiError) || seconds === null) throw error;
    try {
      await countDown(seconds, (left) => onWait({ seconds: left, message: error.message }), signal);
    } finally {
      onWait(null);
    }
    return attempt();
  }
}
