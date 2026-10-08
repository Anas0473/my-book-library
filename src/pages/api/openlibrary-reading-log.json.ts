import type { APIRoute } from 'astro';
import { findMatchingEdition } from '../../lib/editions';
import { getSession, sessionHeaders } from '../../lib/openlibrary-session';
import { OpenLibraryReadTimeoutError, readOpenLibrary } from '../../lib/openlibrary-read';

const shelves = [
  { id: 'want-to-read', status: 'Plan to Read' },
  { id: 'currently-reading', status: 'Reading' },
  { id: 'already-read', status: 'Read' },
];
const pageSize = 100;
const maxPagesPerShelf = 20;
const requestDelayMs = 1100;
const editionBatchSize = 50;

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

export const GET: APIRoute = async ({ url, cookies }) => {
  const username = (url.searchParams.get('username') || '').trim();
  if (!/^[\w.-]{1,64}$/.test(username)) {
    return jsonResponse({ error: 'Enter a valid Open Library username.' }, 400);
  }
  // A logged-in owner can read their own log even when it is private.
  const session = getSession(cookies);
  const requestHeaders = session?.username.toLowerCase() === username.toLowerCase()
    ? sessionHeaders(session.session)
    : { 'User-Agent': 'my-book-library/0.0.1' };

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

        const { response, data } = await readOpenLibrary(apiUrl, {
          timeoutMs: 20000,
          headers: requestHeaders,
        }, (response) => response.json());

        if (!response.ok) {
          return jsonResponse(
            { error: 'Open Library could not read this log. Check the username and make sure its reading log is public.' },
            502,
          );
        }

        if (!data || !Array.isArray(data.reading_log_entries)) {
          throw new Error('Open Library returned an invalid reading-log page.');
        }
        const entries = data.reading_log_entries;

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
            loggedEditionKey: editionKey,
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
    const editionsWithCovers = new Set<string>();
    for (let offset = 0; offset < editionsToEnrich.length; offset += editionBatchSize) {
      if (requestCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
      requestCount++;

      const batch = editionsToEnrich.slice(offset, offset + editionBatchSize);
      const editionIds = batch.map((book) => book.editionKey.split('/').pop());
      const params = new URLSearchParams({
        bibkeys: editionIds.map((id) => `OLID:${id}`).join(','),
        jscmd: 'details',
        format: 'json',
      });

      const { response, data } = await readOpenLibrary(`https://openlibrary.org/api/books?${params}`, {
        timeoutMs: 20000,
        cache: 'no-store',
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      }, (response) => response.json());
      if (!response.ok) {
        throw new Error(`Open Library edition lookup returned ${response.status}`);
      }

      if (!data || typeof data !== 'object') {
        throw new Error('Open Library returned invalid edition details.');
      }
      for (const book of batch) {
        const editionId = book.editionKey.split('/').pop();
        const edition = data[`OLID:${editionId}`]?.details;
        if (!edition || edition.key !== book.editionKey) {
          throw new Error(`Open Library did not return edition ${book.editionKey}`);
        }

        book.title = edition.title || book.title;
        book.subtitle = edition.subtitle || null;
        book.pubDate = Array.isArray(edition.publish_date)
          ? edition.publish_date[0] || book.pubDate
          : edition.publish_date || book.pubDate;
        book.editionLanguage = edition.languages?.[0]?.key?.split('/').pop() || null;
        book.isbn = edition.isbn_13?.[0] || edition.isbn_10?.[0] || null;
        book.publisher = edition.publishers?.[0] || null;
        const coverId = Array.isArray(edition.covers)
          ? edition.covers.find((id: unknown) => typeof id === 'number' && id > 0)
          : null;
        book.editionHeroImage = coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
          : null;
        if (coverId) {
          editionsWithCovers.add(book.loggedEditionKey);
        }
      }
    }

    // Logged editions without a cover are displayed as the work's newest edition that has one.
    const coverlessBooks = editionsToEnrich.filter(
      (book) => !editionsWithCovers.has(book.loggedEditionKey),
    );
    for (const book of coverlessBooks) {
      if (requestCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
      requestCount++;

      const workPath = book.workKey.replace(/^\/+/, '');
      const hasCover = (edition: any) =>
        Array.isArray(edition?.covers) && edition.covers.some((coverId: any) => Number(coverId) > 0);
      const edition = await findMatchingEdition(workPath, '', undefined, 5000, true, true);
      if (!hasCover(edition)) continue;

      const coverId = edition.covers.find((id: any) => Number(id) > 0);
      book.editionKey = edition.key;
      book.editionUrl = `https://openlibrary.org${edition.key}`;
      book.editionHeroImage = `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
      book.title = edition.title || book.title;
      book.subtitle = edition.subtitle || null;
      book.pubDate = edition.publish_date || book.pubDate;
      book.isbn = edition.isbn_13?.[0] || edition.isbn_10?.[0] || null;
      book.publisher = edition.publishers?.[0] || null;
      const editionLanguage = edition.languages?.[0]?.key?.split('/').pop();
      if (editionLanguage) book.editionLanguage = editionLanguage;
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
      { error: error instanceof OpenLibraryReadTimeoutError
        ? 'Open Library took too long to respond, even after retrying. Your saved books were kept. Please try again.'
        : error instanceof TypeError
          ? 'Could not reach Open Library after retrying. Your saved books were kept. Please try again shortly.'
        : 'Could not sync the Open Library reading log. Please try again.' },
      502,
    );
  }
};
