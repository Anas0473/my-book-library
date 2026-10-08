import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenLibraryReadTimeoutError, readOpenLibrary } from '../src/lib/openlibrary-read.ts';

const url = 'https://openlibrary.org/api/books';
const options = { timeoutMs: 20, retryDelayMs: 0, cache: 'no-store' as const };

test('successful reads are fetched once, preserving headers and cache policy', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), url);
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(init?.headers, { 'User-Agent': 'test', Cookie: 'test-session' });
    assert.equal(init?.signal?.aborted, false);
    return Response.json({ books: [1] });
  };
  try {
    const result = await readOpenLibrary(url, {
      ...options, headers: { 'User-Agent': 'test', Cookie: 'test-session' },
    }, (response) => response.json());
    assert.deepEqual(result.data, { books: [1] });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('temporary HTTP errors and network failures retry at most twice', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [408, 429, 500, 502, 503, 504, 'network']) {
      for (const recover of [true, false]) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          if (calls === 1 || !recover) {
            if (status === 'network') throw new TypeError('fetch failed');
            return new Response('', { status: Number(status) });
          }
          return Response.json({ recovered: true });
        };
        if (status === 'network' && !recover) {
          await assert.rejects(readOpenLibrary(url, options, (response) => response.json()), TypeError);
        } else {
          const result = await readOpenLibrary(url, options, (response) => response.json());
          assert.equal(result.response.ok, recover);
          assert.deepEqual(result.data, recover ? { recovered: true } : null);
        }
        assert.equal(calls, recover ? 2 : 3);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('actual request timeouts retry with fresh signals and surface an explicit exhausted-timeout error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const recover of [true, false]) {
      const signals: AbortSignal[] = [];
      globalThis.fetch = async (_input, init) => {
        const signal = init?.signal;
        assert.ok(signal);
        assert.equal(signal.aborted, false);
        signals.push(signal);
        if (recover && signals.length === 3) return Response.json({ recovered: true });
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      };
      if (recover) {
        const result = await readOpenLibrary(url, options, (response) => response.json());
        assert.deepEqual(result.data, { recovered: true });
      } else {
        await assert.rejects(readOpenLibrary(url, options, (response) => response.json()), OpenLibraryReadTimeoutError);
      }
      assert.equal(signals.length, 3);
      assert.notEqual(signals[0], signals[1]);
      assert.notEqual(signals[1], signals[2]);
      assert.equal(signals[0].aborted, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('body reads are covered by the timeout as well as response headers', async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    signal = init?.signal;
    return Response.json({ ok: true });
  };
  try {
    await assert.rejects(readOpenLibrary(url, options, async () => {
      assert.ok(signal);
      const currentSignal = signal;
      return new Promise((_resolve, reject) => {
        currentSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }), OpenLibraryReadTimeoutError);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('permanent failures, malformed JSON and long Retry-After delays do not retry', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 404, 422, 429]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response('', { status, headers: { 'Retry-After': '3600' } });
      };
      const result = await readOpenLibrary(url, options, (response) => response.json());
      assert.equal(result.response.status, status);
      assert.equal(result.data, null);
      assert.equal(calls, 1);
    }
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('not JSON', { status: 200 });
    };
    await assert.rejects(readOpenLibrary(url, options, (response) => response.json()), SyntaxError);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('short Retry-After delays are honored before the single retry', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let failedAt = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      failedAt = performance.now();
      return new Response('', { status: 429, headers: { 'Retry-After': '0.05' } });
    }
    assert.ok(performance.now() - failedAt >= 45);
    return Response.json({ recovered: true });
  };
  try {
    const result = await readOpenLibrary(url, options, (response) => response.json());
    assert.deepEqual(result.data, { recovered: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
