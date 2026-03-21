/**
 * API base URL + fetch with exponential backoff for transient failures.
 * Repo-root .env is loaded in next.config.mjs; default uses 127.0.0.1 for Windows IPv4/IPv6 localhost issues.
 */

const DEFAULT_RETRIABLE_STATUSES = [408, 425, 429, 502, 503, 504];

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

export type FetchWithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * HTTP statuses that trigger a retry. Default: 408, 425, 429, 5xx.
   * Pass [] to retry only on network errors (recommended for non-idempotent POSTs).
   */
  retriableStatuses?: number[];
  /** Short label for dev logging */
  logLabel?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Browser fetch with retries: network failures and (by default) transient HTTP statuses.
 * Respects Retry-After when present. Does not retry after response body is consumed.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: FetchWithRetryOptions
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  const maxDelayMs = opts?.maxDelayMs ?? 30_000;
  const retriable =
    opts?.retriableStatuses === undefined
      ? DEFAULT_RETRIABLE_STATUSES
      : opts.retriableStatuses;
  const label = opts?.logLabel ?? String(input).slice(0, 120);

  let delay = baseDelayMs;
  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (
        !res.ok &&
        retriable.length > 0 &&
        retriable.includes(res.status)
      ) {
        if (attempt === maxAttempts) {
          return res;
        }
        const retryAfter = res.headers.get("Retry-After");
        const fromHeader = retryAfter ? parseInt(retryAfter, 10) * 1000 : NaN;
        const waitMs = Number.isFinite(fromHeader)
          ? Math.min(fromHeader, maxDelayMs)
          : Math.min(delay, maxDelayMs);
        const jitter = Math.random() * Math.min(250, delay * 0.25);
        if (process.env.NODE_ENV === "development") {
          console.debug(
            `[fetchWithRetry] ${label} HTTP ${res.status} attempt ${attempt}/${maxAttempts} → wait ${Math.round(waitMs + jitter)}ms`
          );
        }
        await sleep(waitMs + jitter);
        delay = Math.min(delay * 2, maxDelayMs);
        continue;
      }
      return res;
    } catch (e) {
      lastNetworkError = e;
      if (attempt === maxAttempts) {
        throw e;
      }
      const jitter = Math.random() * Math.min(250, delay * 0.25);
      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[fetchWithRetry] ${label} network error attempt ${attempt}/${maxAttempts}`,
          e
        );
      }
      await sleep(Math.min(delay, maxDelayMs) + jitter);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
  throw lastNetworkError;
}
