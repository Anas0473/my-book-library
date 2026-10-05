export class OpenLibraryReadTimeoutError extends Error {
  constructor() {
    super('Open Library took too long to respond.');
    this.name = 'OpenLibraryReadTimeoutError';
  }
}

interface ReadOptions {
  timeoutMs: number;
  headers?: HeadersInit;
  cache?: RequestCache;
  retryDelayMs?: number;
}

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);

function isTransientError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

// Only read requests are retried; shelf writes and login requests must not be repeated.
export async function readOpenLibrary<T>(
  url: string | URL,
  options: ReadOptions,
  readBody: (response: Response) => Promise<T>,
): Promise<{ response: Response; data: T } | { response: Response; data: null }> {
  const retryDelayMs = options.retryDelayMs ?? 1100;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let delay = retryDelayMs;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: options.headers,
        cache: options.cache,
      });
      if (response.ok) return { response, data: await readBody(response) };
      if (attempt > 0 || !transientStatuses.has(response.status)) {
        return { response, data: null };
      }
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const wait = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        // Do not retry earlier than requested, or wait indefinitely within a sync.
        if (Number.isFinite(wait) && wait > 30000) return { response, data: null };
        if (Number.isFinite(wait)) delay = Math.max(delay, wait);
      }
      await response.body?.cancel();
      console.warn(`Open Library sync read returned ${response.status}; retrying once.`);
    } catch (error) {
      const timedOut = controller.signal.aborted
        || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
      if (attempt > 0 || (!timedOut && !isTransientError(error))) {
        if (timedOut) throw new OpenLibraryReadTimeoutError();
        throw error;
      }
      console.warn('Open Library sync read failed temporarily; retrying once.', error);
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
