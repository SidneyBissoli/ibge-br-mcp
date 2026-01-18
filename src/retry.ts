/**
 * Retry utility with exponential backoff for network requests
 */

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
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 4,
  initialDelayMs: 2000,
  maxDelayMs: 16000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  isRetryable: isNetworkError,
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
    try {
      const response = await fetch(url, init);

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
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const shouldRetry = opts.isRetryable(lastError);

      if (shouldRetry && attempt <= opts.maxRetries) {
        const delay = calculateDelay(attempt, opts);
        await sleep(delay);
        continue;
      }

      // If not retryable or no more retries, throw
      throw lastError;
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
