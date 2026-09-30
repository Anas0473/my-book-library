import type { APIRoute } from 'astro';

const maxBatchSize = 40;
const maxConcurrentRequests = 8;
const requestTimeoutMs = 2500;
const cache = new Map<string, { expiresAt: number; language: string | null }>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const editionKeys = Array.isArray(body.editionKeys)
      ? [...new Set(body.editionKeys
          .map((value: unknown) => String(value || '').match(/OL\d+M/i)?.[0].toUpperCase())
          .filter(Boolean))]
      : [];

    if (editionKeys.length > maxBatchSize) {
      return jsonResponse({ languages: {} }, 413);
    }

    const languages: Record<string, string> = {};
    const resolved: string[] = [];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < editionKeys.length) {
        const editionId = editionKeys[nextIndex++];
        const cached = cache.get(editionId);
        if (cached && cached.expiresAt > Date.now()) {
          resolved.push(editionId);
          if (cached.language) languages[editionId] = cached.language;
          continue;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        let language: string | null = null;
        let resolvedEdition = false;
        try {
          const response = await fetch(`https://openlibrary.org/books/${editionId}.json`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'my-book-library/0.0.1' },
          });
          if (response.ok) {
            const record = await response.json();
            resolvedEdition = true;
            const firstLanguage = record.languages?.[0]?.key || record.languages?.[0];
            language = String(firstLanguage || '').split('/').pop()?.toLowerCase() || null;
          }
        } catch {
          // Leave unresolved records filterable as unknown if Open Library is unavailable.
        } finally {
          clearTimeout(timeout);
        }

        if (resolvedEdition) {
          cache.set(editionId, {
            expiresAt: Date.now() + (language ? 24 : 1) * 60 * 60 * 1000,
            language,
          });
          resolved.push(editionId);
        } else {
          cache.delete(editionId);
        }
        if (language) languages[editionId] = language;
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(maxConcurrentRequests, editionKeys.length) }, worker),
    );
    return jsonResponse({ languages, resolved });
  } catch {
    return jsonResponse({ languages: {} }, 400);
  }
};