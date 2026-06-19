/**
 * Retry utility with exponential backoff for network requests
 */

import { REQUEST_TIMEOUT_MS } from "./config.js";

/**
 * Thrown when a request exceeds its configured timeout. Carries the limit so
 * callers (e.g. `parseHttpError`) can render a precise, user-facing message.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 4) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 2000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 16000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes?: number[];
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Per-request timeout in milliseconds (default: REQUEST_TIMEOUT_MS) */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 4,
  initialDelayMs: 2000,
  maxDelayMs: 16000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  isRetryable: isNetworkError,
  timeoutMs: REQUEST_TIMEOUT_MS,
};

/**
 * Check if an error is a network-related error that should be retried
 */
export function isNetworkError(error: Error): boolean {
  const networkErrorPatterns = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "fetch failed",
    "network error",
    "network request failed",
    "socket hang up",
    "connection reset",
    "connection refused",
    "timeout",
  ];

  const message = error.message.toLowerCase();
  return networkErrorPatterns.some(
    (pattern) => message.includes(pattern.toLowerCase()) || error.name === pattern
  );
}

/**
 * Check if an HTTP status code should trigger a retry
 */
export function isRetryableStatus(status: number, retryableCodes: number[]): boolean {
  return retryableCodes.includes(status);
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for the current retry attempt using exponential backoff
 */
export function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  return Math.min(delay, options.maxDelayMs);
}

/**
 * Build an AbortSignal that fires after `timeoutMs`, also chaining any caller
 * signal passed via `init`. Aborting with a `TimeoutError` reason lets the
 * fetch rejection be recognized as a timeout (vs. a deliberate cancellation).
 * Returns a `cleanup` that must run after each attempt to clear the timer.
 */
function createTimeoutSignal(
  timeoutMs: number,
  upstream?: AbortSignal | null
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs);

  if (upstream) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
    }
  }

  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * Wrapper for fetch with automatic retry on network errors
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    const { signal, cleanup } = createTimeoutSignal(opts.timeoutMs, init?.signal);
    try {
      const response = await fetch(url, { ...init, signal });

      // Check if status code is retryable
      if (!response.ok && isRetryableStatus(response.status, opts.retryableStatusCodes)) {
        lastResponse = response;
        if (attempt <= opts.maxRetries) {
          const delay = calculateDelay(attempt, opts);
          await sleep(delay);
          continue;
        }
      }

      return response;
    } catch (error) {
      // A timeout aborts with a TimeoutError reason; surface that, not the
      // generic AbortError the fetch implementation may throw.
      const timedOut = signal.reason instanceof TimeoutError;
      lastError = timedOut
        ? signal.reason
        : error instanceof Error
          ? error
          : new Error(String(error));

      // Timeouts are transient and retryable; otherwise defer to the predicate.
      const shouldRetry = timedOut || opts.isRetryable(lastError);

      if (shouldRetry && attempt <= opts.maxRetries) {
        const delay = calculateDelay(attempt, opts);
        await sleep(delay);
        continue;
      }

      // If not retryable or no more retries, throw
      throw lastError;
    } finally {
      cleanup();
    }
  }

  // If we exhausted retries with a response, throw an error with the status
  if (lastResponse) {
    throw new Error(
      `HTTP ${lastResponse.status}: ${lastResponse.statusText} (after ${opts.maxRetries} retries)`
    );
  }

  // If we have an error, throw it
  if (lastError) {
    throw lastError;
  }

  // This should never happen, but TypeScript needs it
  throw new Error("Unexpected retry loop exit");
}

/**
 * Retry configuration presets for different scenarios
 */
export const RETRY_PRESETS = {
  /** Standard retry for API requests */
  DEFAULT: {
    maxRetries: 4,
    initialDelayMs: 2000,
  } as RetryOptions,

  /** Aggressive retry for critical requests */
  AGGRESSIVE: {
    maxRetries: 6,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
  } as RetryOptions,

  /** Quick retry for fast-failing requests */
  QUICK: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 2000,
  } as RetryOptions,

  /** No retry */
  NONE: {
    maxRetries: 0,
  } as RetryOptions,
} as const;
