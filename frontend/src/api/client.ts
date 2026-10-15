/** The shape of every error body the backend returns. */
interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ApiErrorInit extends ErrorBody {
  status: number;
}

const NETWORK_ERROR_CODE = 'network_error';
const NETWORK_ERROR_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/** The error codes of a 429 that clears by itself: the weather service's or our own limit. */
const RATE_LIMIT_CODES = ['weather_rate_limited', 'rate_limit_exceeded'];

/** A wait longer than this (an hourly limit with most of the hour to run) is not worth a
 * countdown: the message says so and the driver decides. */
const MAX_AUTOMATIC_RETRY_SECONDS = 120;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor({ code, message, status, details }: ApiErrorInit) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * How long to wait before the same request is likely to work, when a rate limit said so and
   * it is short enough to wait for; otherwise null.
   */
  get retryAfterSeconds(): number | null {
    const seconds = this.details?.retry_after_seconds;
    if (
      this.status !== 429 ||
      !RATE_LIMIT_CODES.includes(this.code) ||
      typeof seconds !== 'number' ||
      !(seconds > 0) ||
      seconds > MAX_AUTOMATIC_RETRY_SECONDS
    ) {
      return null;
    }
    return Math.ceil(seconds);
  }
}

function networkError(status: number): ApiError {
  return new ApiError({
    code: NETWORK_ERROR_CODE,
    message: NETWORK_ERROR_MESSAGE,
    status,
  });
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw networkError(response.status);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, window.location.origin), init);
  } catch {
    throw networkError(0);
  }

  const body = await readJson(response);

  if (!response.ok) {
    if (!isErrorBody(body)) throw networkError(response.status);
    throw new ApiError({ ...body, status: response.status });
  }
  return body as T;
}

export function apiPost<T>(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export function apiGet<T>(path: string, options: { signal?: AbortSignal } = {}): Promise<T> {
  return request<T>(path, { method: 'GET', signal: options.signal });
}
