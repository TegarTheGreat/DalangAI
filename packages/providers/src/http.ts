/**
 * Minimal HTTP helpers with timeout + bounded retry (network dependencies must
 * degrade loudly and predictably, PRD §7.2). Fetch is always injectable so
 * every provider is unit-testable without network.
 */

export type FetchImpl = typeof fetch;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface HttpOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  retries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const httpRequest = async (
  url: string,
  init: RequestInit,
  {
    fetchImpl = fetch,
    timeoutMs = 30_000,
    retries = 2,
    sleep = defaultSleep,
  }: HttpOptions = {},
): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        await sleep(2 ** attempt * 500);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(2 ** attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export const expectOk = async (response: Response, label: string): Promise<Response> => {
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      // body unavailable — status alone will have to do
    }
    throw new Error(`${label} HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response;
};

export const fetchJson = async <T>(
  url: string,
  init: RequestInit,
  label: string,
  options?: HttpOptions,
): Promise<T> => {
  const response = await expectOk(await httpRequest(url, init, options), label);
  return (await response.json()) as T;
};

export const fetchBytes = async (
  url: string,
  init: RequestInit,
  label: string,
  options?: HttpOptions,
): Promise<Uint8Array> => {
  const response = await expectOk(
    await httpRequest(url, init, { timeoutMs: 120_000, ...options }),
    label,
  );
  return new Uint8Array(await response.arrayBuffer());
};
