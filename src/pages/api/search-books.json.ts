import type { APIRoute } from 'astro';
import { findMatchingEdition as lookupMatchingEdition } from '../../lib/editions';

const matchingEditionCache = new Map<string, { expiresAt: number; edition: any }>();
const findSearchMatchingEdition = async (
  ...args: Parameters<typeof lookupMatchingEdition>
) => {
  const key = JSON.stringify([args[0], args[1], args[2], args[4]]);
  const cached = matchingEditionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.edition;
  const edition = await lookupMatchingEdition(args[0], args[1], args[2], args[3], args[4], true);
  if (edition) {
    matchingEditionCache.set(key, { expiresAt: Date.now() + 10 * 60 * 1000, edition });
  }
  return edition;
};

async function mapEditionLookups<T, R>(
  items: T[],
  lookup: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await lookup(items[index], index);
    }
  }));
  return results;
}

const languageEditionCache = new Map<string, { expiresAt: number; edition: any | null }>();
const searchResponseCache = new Map<string, { expiresAt: number; data: any }>();
const selectedEditionCache = new Map<string, { expiresAt: number; edition: any | null }>();

async function fetchOpenLibrarySearch(apiUrl: string) {
  const cached = searchResponseCache.get(apiUrl);
  if (cached && cached.expiresAt > Date.now()) {
    // Check the search service itself, not just the homepage, before using cached data.
    const probeUrl = new URL(apiUrl);
    probeUrl.searchParams.set('limit', '1');
    probeUrl.searchParams.set('offset', '0');
    probeUrl.searchParams.set('fields', 'key');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(probeUrl, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.docs) ? cached.data : null;
    } catch {
      // A failed availability check must never serve cached Open Library results.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data.docs)) return null;
        searchResponseCache.set(apiUrl, { expiresAt: Date.now() + 10 * 60 * 1000, data });
        return data;
      }
    } catch {
      // Retry once; Open Library's large searches intermittently time out.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function fetchSelectedEdition(editionKey: string) {
  const editionId = editionKey.match(/OL\d+M/i)?.[0].toUpperCase();
  if (!editionId) return null;

  const cached = selectedEditionCache.get(editionId);
  if (cached && cached.expiresAt > Date.now()) return cached.edition;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  let edition: any = null;
  try {
    const response = await fetch(`https://openlibrary.org/books/${editionId}.json`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'my-book-library/0.0.1' },
    });
    if (response.ok) edition = await response.json();
    else if (response.status !== 404) {
      throw new Error(`Open Library edition returned ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  selectedEditionCache.set(editionId, {
    expiresAt: Date.now() + (edition ? 10 : 2) * 60 * 1000,
    edition,
  });
  return edition;
}

async function fetchInternetArchiveFallback({
  query,
  authorOnly,
  isIsbnSearch,
  normalizedIsbn,
  language,
  sort,
  page,
  limit,
}: {
  query: string;
  authorOnly: boolean;
  isIsbnSearch: boolean;
  normalizedIsbn: string;
  language?: string;
  sort: string;
  page: number;
  limit: number;
}) {
  const field = isIsbnSearch ? 'isbn' : authorOnly ? 'creator' : 'title';
  const value = isIsbnSearch ? normalizedIsbn : query.trim().replace(/["\\]/g, '\\$&');
  const queryParts = [
    `${field}:"${value}"`,
    'mediatype:texts',
    'collection:inlibrary',
  ];
  if (language) queryParts.push(`language:${language}`);
  const params = new URLSearchParams({
    q: queryParts.join(' AND '),
    'fl[]': 'identifier,title,creator,publisher,year,language,isbn',
    rows: '1000',
    page: '1',
    output: 'json',
  });
  const apiUrl = `https://archive.org/advancedsearch.php?${params}`;
  const cached = searchResponseCache.get(apiUrl);
  let data = cached && cached.expiresAt > Date.now() ? cached.data : null;
  if (!data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiUrl, { signal: controller.signal });
      if (!response.ok) return null;
      data = await response.json();
      searchResponseCache.set(apiUrl, { expiresAt: Date.now() + 10 * 60 * 1000, data });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  const books = (data.response?.docs || []).map((item: any) => {
    const languageCode = Array.isArray(item.language) ? item.language[0] : item.language;
    const cover = item.identifier
      ? `https://archive.org/services/img/${encodeURIComponent(item.identifier)}`
      : null;
    const isbn = Array.isArray(item.isbn) ? item.isbn[0] : item.isbn;
    return {
      key: `archive:${item.identifier}`,
      workKey: null,
      provider: 'internet-archive',
      editionUrl: `https://archive.org/details/${encodeURIComponent(item.identifier)}`,
      editionHeroImage: cover,
      title: item.title || 'Untitled',
      subtitle: null,
      author: Array.isArray(item.creator) ? item.creator.join(', ') : item.creator || 'Unknown Author',
      publisher: Array.isArray(item.publisher) ? item.publisher[0] : item.publisher || null,
      authorKeys: [],
      editionKeys: [],
      editionCount: 0,
      editionLanguage: languageCode || null,
      languages: languageCode ? [languageCode] : [],
      pubDate: item.year || 'Unknown',
      isbn: isbn || null,
      heroImage: cover,
    };
  });
  if (sort.startsWith('title')) {
    books.sort((first: any, second: any) => {
      const comparison = String(first.title).localeCompare(String(second.title), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sort === 'title-desc' ? -comparison : comparison;
    });
  } else if (sort.startsWith('year')) {
    books.sort((first: any, second: any) => {
      const firstYear = Number(first.pubDate) || 0;
      const secondYear = Number(second.pubDate) || 0;
      return sort === 'year-desc' ? secondYear - firstYear : firstYear - secondYear;
    });
  }

  const totalResults = Math.min(Number(data.response?.numFound) || 0, books.length);
  const languages = Array.from(new Set(books.flatMap((book: any) => book.languages))) as string[];
  if (language && !languages.includes(language)) languages.push(language);
  return {
    books: books.slice((page - 1) * limit, page * limit),
    totalResults,
    page,
    totalPages: Math.ceil(totalResults / limit),
    allResults: false,
    languages,
    searchProvider: 'internet-archive',
  };
}

async function findEditionInLanguage(workKey: string, language: string) {
  const cacheKey = `${workKey}:${language}`;
  const cached = languageEditionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.edition;

  const edition = await findSearchMatchingEdition(workKey, '', language, 2500);
  languageEditionCache.set(cacheKey, {
    expiresAt: Date.now() + (edition ? 15 : 2) * 60 * 1000,
    edition,
  });
  return edition;
}

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q');
  const authorOnly = url.searchParams.get('author') === '1';
  const authorKey = url.searchParams.get('author_key')?.trim();
  const authorExact = url.searchParams.get('author_exact') === '1';
  const language = url.searchParams.get('language')?.trim();
  const discoverLanguages = url.searchParams.get('discover_languages') === '1';
  const includeAllResults = url.searchParams.get('all_results') === '1';
  const sort = url.searchParams.get('sort') || '';
  const shouldSort = ['title-asc', 'title-desc', 'year-desc', 'year-asc'].includes(sort);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const requestedLimit = parseInt(url.searchParams.get('limit') || '18', 10);
  const limit = [14, 15, 18].includes(requestedLimit) ? requestedLimit : 16;
  const offset = (page - 1) * limit;

  const jsonHeaders = { 'Content-Type': 'application/json' };

  if (!query) {
    return new Response(
      JSON.stringify({ books: [], totalResults: 0, page: 1, totalPages: 0 }),
      { status: 200, headers: jsonHeaders }
    );
  }

  const trimmedQuery = query.trim();
  const normalizedIsbn = trimmedQuery
    .replace(/^ISBN(?:-1[03])?\s*[:#]?\s*/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  const isIsbnSearch = !authorKey
    && !authorOnly
    && /^(?:\d{9}[\dX]|\d{13})$/.test(normalizedIsbn);
  const directUrlMatch = trimmedQuery.match(
    /(?:https?:\/\/(?:www\.)?openlibrary\.org)?\/?(books|works)\/(OL\d+[MW])(?:[/?#]|$)/i,
  );
  const directIdMatch = trimmedQuery.match(/^(OL\d+[MW])$/i);
  const directType = directUrlMatch?.[1].toLowerCase()
    || (directIdMatch?.[1].toUpperCase().endsWith('M') ? 'books' : directIdMatch ? 'works' : null);
  const directId = directUrlMatch?.[2] || directIdMatch?.[1];

  let editionLookupFailed = false;
  const optionalEditionLookup = async <T>(lookup: () => Promise<T>): Promise<T | null> => {
    try {
      return await lookup();
    } catch (error) {
      editionLookupFailed = true;
      console.warn('Open Library edition enrichment failed; checking search availability:', error);
      return null;
    }
  };
  const findMatchingEdition = (...args: Parameters<typeof lookupMatchingEdition>) =>
    optionalEditionLookup(() => findSearchMatchingEdition(...args));

  const unavailableResponse = async () => {
    const fallback = await fetchInternetArchiveFallback({
      query, authorOnly, isIsbnSearch, normalizedIsbn, language, sort, page, limit,
    });
    return new Response(
      JSON.stringify(fallback || {
        books: [], totalResults: 0, page, totalPages: 0, searchUnavailable: true,
      }),
      { status: 200, headers: jsonHeaders },
    );
  };

  try {
    if (directType && directId) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let directResponse: Response;
      try {
        directResponse = await fetch(`https://openlibrary.org/${directType}/${directId}.json`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'my-book-library/0.0.1' },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!directResponse.ok) {
        if (directResponse.status !== 404) return unavailableResponse();
        return new Response(
          JSON.stringify({ books: [], totalResults: 0, page: 1, totalPages: 0 }),
          { status: 200, headers: jsonHeaders },
        );
      }

      const record = await directResponse.json();
      const isEdition = directType === 'books';
      const workKey = isEdition ? record.works?.[0]?.key || null : record.key;
      const key = workKey || record.key;
      const coverId = isEdition ? record.covers?.[0] : record.covers?.[0];
      let author = Array.isArray(record.authors)
        ? record.authors.map((item: any) => item.name).filter(Boolean).join(', ')
        : record.by_statement?.replace(/^by\s+/i, '') || 'Unknown Author';

      if ((!author || author === 'Unknown Author') && workKey) {
        const authorParams = new URLSearchParams({
          q: `key:${workKey}`,
          fields: 'author_name',
          limit: '1',
        });
        try {
          const authorResponse = await fetch(`https://openlibrary.org/search.json?${authorParams}`);
          if (authorResponse.ok) {
            const authorData = await authorResponse.json();
            const authorNames = authorData.docs?.[0]?.author_name;
            if (Array.isArray(authorNames) && authorNames.length > 0) {
              author = authorNames.join(', ');
            }
          }
        } catch {
          // Keep the edition result usable when author lookup is unavailable.
        }
      }
      const book = {
        key,
        workKey: workKey || record.key,
        editionKey: isEdition ? record.key : null,
        editionUrl: isEdition ? `https://openlibrary.org${record.key}` : null,
        editionHeroImage: isEdition && coverId
          ? `https://covers.openlibrary.org/b/olid/${directId}-M.jpg?default=false`
          : null,
        title: record.title || 'Untitled',
        subtitle: record.subtitle || null,
        author,
        publisher: Array.isArray(record.publishers) ? record.publishers[0] || null : record.publishers || null,
        pubDate: record.publish_date || record.first_publish_year || 'Unknown',
        isbn: record.isbn_13?.[0] || record.isbn_10?.[0] || null,
        heroImage: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null,
      };

      return new Response(
        JSON.stringify({ books: [book], totalResults: 1, page: 1, totalPages: 1 }),
        { status: 200, headers: jsonHeaders },
      );
    }

    const searchField = authorKey
      ? 'author_key'
      : authorOnly
        ? 'author'
        : isIsbnSearch
          ? 'isbn'
          : query.trim().split(/\s+/).length > 1 ? 'q' : 'title';
    const isGeneralQuery = !authorKey && !authorOnly && !isIsbnSearch
      && query.trim().split(/\s+/).length > 1;
    const structuredQuery = isGeneralQuery
      ? query.trim().split(/\s+/)
          .map((term) => term.replace(/["\\]/g, '').trim())
          .filter(Boolean)
          .map((term, index, terms) => {
            const fields = ['title', 'subtitle', 'author'];
            const alternatives = fields.flatMap((field) => [
              `${field}:"${term}"`,
              ...(index === terms.length - 1 ? [`${field}:${term}*`] : []),
            ]);
            return `(${alternatives.join(' OR ')})`;
          })
          .join(' AND ')
      : query;
    const hasCompleteResultSet = includeAllResults || authorExact;
    const useOpenLibrarySort = shouldSort && !hasCompleteResultSet;
    const openLibrarySort = sort.startsWith('title')
      ? 'title'
      : sort === 'year-desc'
        ? 'new'
        : sort === 'year-asc'
          ? 'old'
          : '';
    const searchParams = new URLSearchParams({
      [searchField]: isIsbnSearch ? normalizedIsbn : authorKey || structuredQuery,
      fields: 'title,subtitle,author_name,author_key,language,first_publish_year,cover_i,isbn,publisher,key,edition_key,edition_count',
      limit: String(hasCompleteResultSet ? 1000 : limit),
      offset: String(hasCompleteResultSet || (useOpenLibrarySort && sort === 'title-desc') ? 0 : offset),
    });
    const languageSearchParams = new URLSearchParams(searchParams);
    languageSearchParams.set('limit', '1000');
    languageSearchParams.set('offset', '0');
    if (language) searchParams.set('language', language);
    const excludedWorkKeys = url.searchParams.getAll('exclude_work_key')
      .map((workKey) => workKey.trim())
      .filter((workKey) => /^\/?works\/OL\d+W$/i.test(workKey))
      .map((workKey) => `NOT key:${workKey.startsWith('/') ? workKey : `/${workKey}`}`);
    const excludedIsbns = url.searchParams.getAll('exclude_isbn')
      .map((isbn) => isbn.replace(/[\s-]/g, '').toUpperCase())
      .filter((isbn) => /^(?:\d{9}[\dX]|\d{13})$/.test(isbn))
      .map((isbn) => `NOT isbn:${isbn}`);
    const exclusionFilters = [...excludedWorkKeys, ...excludedIsbns];
    if (exclusionFilters.length > 0) {
      const queryFilter = [searchParams.get('q'), ...exclusionFilters].filter(Boolean).join(' AND ');
      searchParams.set('q', queryFilter);
    }
    if (useOpenLibrarySort && openLibrarySort) searchParams.set('sort', openLibrarySort);
    const apiUrl = `https://openlibrary.org/search.json?${searchParams}`;
    let data = await fetchOpenLibrarySearch(apiUrl);

    if (!data) {
      return unavailableResponse();
    }
    if (useOpenLibrarySort && sort === 'title-desc') {
      const reverseCount = Math.max(0, Math.min(limit, (Number(data.numFound) || 0) - offset));
      const reverseOffset = Math.max(0, (Number(data.numFound) || 0) - offset - reverseCount);
      if (reverseOffset !== 0 || reverseCount !== limit) {
        searchParams.set('offset', String(reverseOffset));
        searchParams.set('limit', String(reverseCount));
        data = await fetchOpenLibrarySearch(`https://openlibrary.org/search.json?${searchParams}`);
        if (!data) {
          return unavailableResponse();
        }
      }
      data = { ...data, docs: [...(data.docs || [])].reverse() };
    }
    let isbnEdition: any = null;
    if (isIsbnSearch) {
      const isbnController = new AbortController();
      const isbnTimeout = setTimeout(() => isbnController.abort(), 8000);
      await optionalEditionLookup(async () => {
        try {
          const isbnResponse = await fetch(`https://openlibrary.org/isbn/${normalizedIsbn}.json`, {
            signal: isbnController.signal,
            headers: { 'User-Agent': 'my-book-library/0.0.1' },
          });
          if (isbnResponse.ok) isbnEdition = await isbnResponse.json();
          else if (isbnResponse.status !== 404) {
            throw new Error(`Open Library ISBN lookup returned ${isbnResponse.status}`);
          }
        } finally {
          clearTimeout(isbnTimeout);
        }
        return isbnEdition;
      });
    }
    // OpenLibrary's general "q" search matches loosely across unrelated fields
    // (e.g. subjects and contributor notes). Prefer results where the full phrase
    // appears in the title, subtitle, or an author's name, but retain top-ranked
    // results when no visible text matches (for alternate or translated titles).
    const normalizedPhrase = query.trim().toLocaleLowerCase();
    const topRankedCount = 5;
    const docs = data.docs || [];
    const relevantDocs = docs;
    const fallbackEditionMatches = new Map<string, any>();
    const authorMatchingDocs = authorExact
      ? relevantDocs.filter((doc: any) =>
          (doc.author_name || []).some(
            (name: string) => name.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ),
        )
      : relevantDocs;
    const titleEditionMatches = new Map<string, any>();
    if (isGeneralQuery && !language) {
      const titleCandidates = authorMatchingDocs
        .map((doc: any) => {
          const title = String(doc.title || '').toLocaleLowerCase();
          const subtitle = String(doc.subtitle || '').toLocaleLowerCase();
          const relevance = title.includes(normalizedPhrase) ? 2 : subtitle.includes(normalizedPhrase) ? 1 : 0;
          return { doc, relevance };
        })
        .filter(({ doc, relevance }: any) => doc.key && relevance > 0)
        .sort((first: any, second: any) =>
          (Number(second.doc.edition_count) || 0) - (Number(first.doc.edition_count) || 0) ||
          second.relevance - first.relevance,
        )
        .slice(0, topRankedCount);
      const editions = await mapEditionLookups(titleCandidates, ({ doc }: any) => {
        const docKey = String(doc.key);
        return fallbackEditionMatches.has(docKey)
          ? fallbackEditionMatches.get(docKey)
          : findMatchingEdition(docKey.replace(/^\/+/, ''), normalizedPhrase, undefined, 2500, true);
      });
      titleCandidates.forEach(({ doc }: any, index: number) => {
        if (editions[index]) titleEditionMatches.set(String(doc.key), editions[index]);
      });
    }
    const languageEditionMatches = new Map<string, any>();
    if (language) {
      const untaggedDocs = authorMatchingDocs.filter((doc: any) =>
        (!doc.language || doc.language.length === 0) && doc.key,
      );
      const lookupBatchSize = 30;
      for (let offset = 0; offset < untaggedDocs.length; offset += lookupBatchSize) {
        const batch = untaggedDocs.slice(offset, offset + lookupBatchSize);
        const editions = await mapEditionLookups(batch, (doc: any) =>
          optionalEditionLookup(() => findEditionInLanguage(String(doc.key).replace(/^\/+/, ''), language)),
        );
        batch.forEach((doc: any, index: number) => {
          if (editions[index]) languageEditionMatches.set(String(doc.key), editions[index]);
        });
      }
    }
    const languageDiscoveryUrl = `https://openlibrary.org/search.json?${languageSearchParams}`;
    const languageDiscoveryData = discoverLanguages
      ? languageDiscoveryUrl === apiUrl ? data : await fetchOpenLibrarySearch(languageDiscoveryUrl)
      : null;
    if (discoverLanguages && !languageDiscoveryData) return unavailableResponse();
    const languageOptionDocs = languageDiscoveryData?.docs || authorMatchingDocs;
    const languageOptionMatchingDocs = authorExact
      ? languageOptionDocs.filter((doc: any) =>
          (doc.author_name || []).some(
            (name: string) => name.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ),
        )
      : languageOptionDocs;
    const languageOptions = Array.from(new Set([
      ...languageOptionMatchingDocs.flatMap((doc: any) => doc.language || []),
      ...(languageEditionMatches.size > 0 && language ? [language] : []),
    ])).sort();
    const matchingDocs = language
      ? authorMatchingDocs.filter((doc: any) =>
          (doc.language || []).includes(language) || languageEditionMatches.has(String(doc.key)),
        )
      : authorMatchingDocs;
    const editionPublicationYear = (doc: any) => {
      const edition = titleEditionMatches.get(String(doc.key))
        || fallbackEditionMatches.get(String(doc.key))
        || languageEditionMatches.get(String(doc.key));
      const dates = Array.isArray(edition?.publish_date)
        ? edition.publish_date
        : [edition?.publish_date];
      const years = dates.map((date: any) => {
        const year = String(date || '').match(/\b\d{4}\b/)?.[0];
        if (year) return Number(year);
        const timestamp = Date.parse(String(date || ''));
        return Number.isFinite(timestamp) ? new Date(timestamp).getFullYear() : 0;
      }).filter((year: number) => year > 0);
      return years.length > 0 ? Math.max(...years) : Number(doc.first_publish_year) || 0;
    };
    const sortedDocs = shouldSort && hasCompleteResultSet
      ? [...matchingDocs].sort((first: any, second: any) => {
          if (sort.startsWith('title')) {
            const titleComparison = String(first.title || '').localeCompare(
              String(second.title || ''),
              undefined,
              { numeric: true, sensitivity: 'base' },
            );
            const subtitleComparison = String(first.subtitle || '').localeCompare(
              String(second.subtitle || ''),
              undefined,
              { numeric: true, sensitivity: 'base' },
            );
            const comparison = titleComparison || subtitleComparison;
            return sort === 'title-desc' ? -comparison : comparison;
          }

          const firstYear = editionPublicationYear(first);
          const secondYear = editionPublicationYear(second);
          return sort === 'year-desc' ? secondYear - firstYear : firstYear - secondYear;
        })
      : matchingDocs;
    const totalResults = hasCompleteResultSet
      ? sortedDocs.length
      : data.numFound || 0;
    const totalPages = Math.ceil(totalResults / limit);
    const pageDocs = hasCompleteResultSet
      ? includeAllResults ? sortedDocs : sortedDocs.slice(offset, offset + limit)
      : sortedDocs;

    // Reuse sort-independent edition lookups so displayed details remain stable across sorts.
    const editionLookupDocs = includeAllResults ? pageDocs.slice(0, limit) : pageDocs;
    const matchedEditions = isIsbnSearch
      ? editionLookupDocs.map((doc: any) =>
          isbnEdition && (
            isbnEdition.works?.some((work: any) => work.key === doc.key)
            || editionLookupDocs.length === 1
          ) ? isbnEdition : null,
        )
      : isGeneralQuery || language
      ? await mapEditionLookups(
          editionLookupDocs, (doc: any) => {
            if (!doc.key) return null;
            const docKey = String(doc.key);
            if (language) {
              return findMatchingEdition(docKey.replace(/^\/+/, ''), normalizedPhrase, language, 2500, true);
            }
            return fallbackEditionMatches.get(docKey) || titleEditionMatches.get(docKey) || null;
          },
        )
      : pageDocs.map(() => null);
      const editionDetailsDocs = includeAllResults ? pageDocs.slice(0, limit) : pageDocs;
      const selectedEditions = await mapEditionLookups(editionDetailsDocs, async (doc: any, index: number) => {
        const matchedEdition = matchedEditions[index];
        let edition = matchedEdition;
        const editionKey = matchedEdition?.key || (!isIsbnSearch && !language ? doc.edition_key?.[0] : '');
        if (!edition && editionKey) {
          edition = await optionalEditionLookup(() => fetchSelectedEdition(String(editionKey)));
        }

        const hasCover = Array.isArray(edition?.covers)
          && edition.covers.some((coverId: any) => Number(coverId) > 0);
        if (!hasCover && doc.key) {
          const coverEdition = await findMatchingEdition(
            String(doc.key).replace(/^\/+/, ''),
            normalizedPhrase,
            language,
            2500,
            true,
          );
          if (coverEdition?.covers?.some((coverId: any) => Number(coverId) > 0)) {
            edition = coverEdition;
          }
        }
        return edition;
      });

    if (editionLookupFailed && !await fetchOpenLibrarySearch(apiUrl)) {
      return unavailableResponse();
    }

    const formattedBooks = pageDocs.map((doc: any, index: number) => {
        const edition = selectedEditions[index] || matchedEditions[index];
      const selectedEditionId = String(edition?.key || (!isIsbnSearch && !language ? doc.edition_key?.[0] : '') || '')
        .match(/OL\d+M/i)?.[0].toUpperCase() || null;
      return {
        key: doc.key,
        workKey: doc.key,
        editionKey: selectedEditionId ? `/books/${selectedEditionId}` : null,
        editionUrl: selectedEditionId ? `https://openlibrary.org/books/${selectedEditionId}` : null,
        editionLanguage: edition?.languages?.[0]?.key?.split('/').pop() || (language && edition ? language : null),
        editionHeroImage: edition?.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-M.jpg`
          : selectedEditionId
            ? `https://covers.openlibrary.org/b/olid/${selectedEditionId}-M.jpg?default=false`
            : null,
        title: edition?.title || doc.title,
        subtitle: edition?.subtitle || doc.subtitle || null,
        author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
        publisher: edition?.publishers?.[0] || (Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher) || null,
        authorKeys: doc.author_key || [],
        editionKeys: edition?.key ? [edition.key.replace(/^\/?books\//i, '')] : (doc.edition_key || []),
        editionCount: Number(doc.edition_count) || doc.edition_key?.length || 0,
        languages: edition?.languages?.length
          ? edition.languages.map((item: any) => item.key?.split('/').pop()).filter(Boolean)
          : doc.language || [],
        pubDate: edition?.publish_date || doc.first_publish_year || 'Unknown',
        isbn: isIsbnSearch
          ? normalizedIsbn
          : edition?.isbn_13?.[0] || edition?.isbn_10?.[0] || (doc.isbn ? doc.isbn[0] : null),
        heroImage: edition?.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-M.jpg`
          : !language && doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : null,
      };
    }).filter((book: any) => !language || book.editionLanguage === language);

    return new Response(
      JSON.stringify({
        books: formattedBooks,
        totalResults,
        page,
        totalPages,
        allResults: includeAllResults,
        languages: languageOptions,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      }
    );
  } catch (error) {
    console.error('API Fetch error:', error);
    return unavailableResponse();
  }
};