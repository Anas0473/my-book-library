import type { APIRoute } from 'astro';

const shelves = [
  { id: 'want-to-read', status: 'Plan to Read' },
  { id: 'currently-reading', status: 'Reading' },
  { id: 'already-read', status: 'Read' },
];
const pageSize = 100;
const maxPagesPerShelf = 20;
const requestDelayMs = 1100;
const editionBatchSize = 20;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Open Library sends logged_date as "YYYY/MM/DD, HH:MM:SS" in UTC.
function parseLoggedDate(value: unknown) {
  const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export const GET: APIRoute = async ({ url }) => {
  const username = (url.searchParams.get('username') || '').trim();
  if (!/^[\w.-]{1,64}$/.test(username)) {
    return jsonResponse({ error: 'Enter a valid Open Library username.' }, 400);
  }

  const books = new Map<string, any>();
  const incompleteShelves: Array<{ status: string }> = [];
  let requestCount = 0;
  let truncated = false;

  try {
    for (const shelf of shelves) {
      let shelfComplete = false;
      const seenPageSignatures = new Set<string>();

      for (let page = 1; page <= maxPagesPerShelf; page++) {
        if (requestCount > 0) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
        }
        requestCount++;

        const apiUrl = new URL(
          `https://openlibrary.org/people/${encodeURIComponent(username)}/books/${shelf.id}.json`,
        );
        apiUrl.searchParams.set('limit', String(pageSize));
        apiUrl.searchParams.set('page', String(page));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
          response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'my-book-library/0.0.1' },
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          return jsonResponse(
            { error: 'Open Library could not read this log. Check the username and make sure its reading log is public.' },
            502,
          );
        }

        const data = await response.json();
        const entries = Array.isArray(data.reading_log_entries)
          ? data.reading_log_entries
          : [];

        if (entries.length === 0) {
          shelfComplete = true;
          break;
        }

        const pageSignature = entries
          .map((entry: any) => entry.work?.key || entry.logged_edition || '')
          .join('|');
        if (seenPageSignatures.has(pageSignature)) break;
        seenPageSignatures.add(pageSignature);

        for (const entry of entries) {
          const work = entry.work;
          if (!work?.key || !work?.title) continue;

          const editionKey = typeof entry.logged_edition === 'string'
            ? entry.logged_edition
            : null;
          const editionId = editionKey?.match(/^\/books\/([A-Za-z0-9]+)$/)?.[1] || null;
          const bookIdentity = editionKey || work.key;

          books.set(bookIdentity, {
            key: work.key,
            workKey: work.key,
            editionKey,
            editionUrl: editionKey ? `https://openlibrary.org${editionKey}` : null,
            editionHeroImage: editionId
              ? `https://covers.openlibrary.org/b/olid/${editionId}-M.jpg?default=false`
              : null,
            title: work.title,
            workTitle: work.title,
            subtitle: work.subtitle || null,
            author: Array.isArray(work.author_names)
              ? work.author_names.join(', ')
              : 'Unknown Author',
            pubDate: work.first_publish_year || 'Unknown',
            isbn: null,
            heroImage: work.cover_id
              ? `https://covers.openlibrary.org/b/id/${work.cover_id}-M.jpg`
              : null,
            status: shelf.status,
            dateAdded: parseLoggedDate(entry.logged_date),
          });
        }

      }

      if (!shelfComplete) {
        truncated = true;
        incompleteShelves.push({ status: shelf.status });
      }
    }

    const editionsToEnrich = Array.from(books.values()).filter((book) => book.editionKey);
    for (let offset = 0; offset < editionsToEnrich.length; offset += editionBatchSize) {
      if (requestCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
      requestCount++;

      const batch = editionsToEnrich.slice(offset, offset + editionBatchSize);
      const editionIds = batch.map((book) => book.editionKey.split('/').pop());
      const params = new URLSearchParams({
        q: `edition_key:(${editionIds.join(' OR ')})`,
        fields: 'key,title,isbn,publisher,editions,editions.key,editions.title,editions.subtitle,editions.publish_date,editions.cover_i,editions.language',
        limit: String(editionBatchSize),
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'my-book-library/0.0.1' },
        });
        if (!response.ok) continue;

        const data = await response.json();
        for (const work of data.docs || []) {
          for (const edition of work.editions?.docs || []) {
            const book = books.get(edition.key);
            if (!book) continue;

            book.title = edition.title || book.title;
            book.subtitle = edition.subtitle || book.subtitle;
            book.pubDate = Array.isArray(edition.publish_date)
              ? edition.publish_date[0] || book.pubDate
              : edition.publish_date || book.pubDate;
            const editionLanguage = Array.isArray(edition.language)
              ? edition.language[0]
              : edition.language;
            book.editionLanguage = typeof editionLanguage === 'string'
              ? editionLanguage.split('/').pop()
              : editionLanguage?.key?.split('/').pop() || null;
            book.isbn = work.isbn?.[0] || book.isbn || null;
            book.publisher = work.publisher?.[0] || book.publisher || null;
            if (edition.cover_i) {
              book.editionHeroImage = `https://covers.openlibrary.org/b/id/${edition.cover_i}-M.jpg`;
            }
          }
        }
      } catch (error) {
        console.error('Open Library edition lookup error:', error);
      } finally {
        clearTimeout(timeout);
      }
    }

    return jsonResponse({
      username,
      books: Array.from(books.values()),
      truncated,
      incompleteShelves,
    });
  } catch (error) {
    console.error('Open Library reading log sync error:', error);
    return jsonResponse(
      { error: 'Could not sync the Open Library reading log. Please try again.' },
      502,
    );
  }
};
