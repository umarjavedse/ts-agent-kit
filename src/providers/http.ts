export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class ProviderHttpError extends Error {
  override name = "ProviderHttpError";
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Provider request failed with HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** POST JSON with retries and exponential backoff on rate limits and server errors. */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options: { fetch?: FetchLike; signal?: AbortSignal; retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 3;
  const baseDelay = options.baseDelayMs ?? 500;

  for (let attempt = 0; ; attempt++) {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (response.ok) return (await response.json()) as T;

    const text = await response.text();
    if (!RETRYABLE.has(response.status) || attempt >= retries) {
      throw new ProviderHttpError(response.status, text);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelay * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
