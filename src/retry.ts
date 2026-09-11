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

/**
 * Uma resposta HTTP de erro da fonte, COM o que a fonte disse.
 *
 * Por que existe. Até 11/09/2026 o erro era `new Error("HTTP 400: Bad Request")`
 * e o corpo da resposta ia para o lixo. O SIDRA responde 400 a toda chamada
 * malformada e o corpo é uma frase que resolve o problema sozinha — "Parâmetro
 * N3 (Nível territorial) incompatível com a tabela", "Parâmetro V (Variável)
 * com código 9999 inexistente na tabela", "Tabela 99999: Tabela inválida".
 * Quem chamava recebia "Parâmetros inválidos. Verifique se os parâmetros estão
 * no formato correto", que não diz QUAL parâmetro nem POR QUÊ, e a única saída
 * era tentar outra combinação.
 *
 * A `message` continua começando por `HTTP <código>: <texto>` de propósito: é
 * o que `parseHttpError` usa para achar o código, e mudar a forma quebraria a
 * leitura em silêncio.
 */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    /** O que a fonte respondeu no corpo, já limpo e cortado. Vazio quando não há. */
    public readonly detalhe?: string,
    sufixo = ""
  ) {
    super(`HTTP ${status}: ${statusText}${sufixo}${detalhe ? ` — ${detalhe}` : ""}`);
    this.name = "UpstreamError";
  }
}

/**
 * O corpo de uma resposta de erro, pronto para ir ao chamador — ou `undefined`.
 *
 * Três guardas, cada uma por um motivo: HTML é página de erro de borda e não
 * ensina nada (e vem em quilobytes); o corte em 300 caracteres existe porque
 * este texto entra numa mensagem que o modelo lê inteira; e o `catch` cobre
 * corpo já consumido ou conexão cortada, onde não ter detalhe é melhor que
 * derrubar o tratamento do erro.
 */
export async function motivoUpstream(response: Response): Promise<string | undefined> {
  try {
    const cru = (await response.text()).trim();
    if (!cru || cru.startsWith("<")) return undefined;
    // JSON de erro das APIs do IBGE em v1/v3 traz a frase numa chave; texto
    // cru é o caso do SIDRA. Tentar a chave antes de despejar o JSON inteiro.
    let texto = cru;
    try {
      const j = JSON.parse(cru) as Record<string, unknown>;
      for (const chave of ["message", "mensagem", "erro", "error", "detail"]) {
        if (typeof j[chave] === "string" && j[chave]) {
          texto = j[chave] as string;
          break;
        }
      }
    } catch {
      // Não era JSON — o texto cru é a mensagem, que é o caso do SIDRA.
    }
    const limpo = texto.replace(/\s+/g, " ").trim();
    if (!limpo) return undefined;
    return limpo.length > 300 ? `${limpo.slice(0, 297)}...` : limpo;
  } catch {
    return undefined;
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
    throw new UpstreamError(
      lastResponse.status,
      lastResponse.statusText,
      await motivoUpstream(lastResponse),
      ` (after ${opts.maxRetries} retries)`
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
