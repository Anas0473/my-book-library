import type { APIRoute } from 'astro';

// Finds the best matching edition, preferring editions with covers and then newer dates.
async function findMatchingEdition(
  workKey: string,
  normalizedQuery: string,
  language?: string,
  timeoutMs = 5000,
  preferNewest = false,
) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const params = new URLSearchParams({
      limit: '100',
      fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages',
    });
    let response: Response;
    try {
      response = await fetch(`https://openlibrary.org/${workKey}/editions.json?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;

    const data = await response.json();
    const entries = (data.entries || []).filter((edition: any) => /^\/books\/OL\d+M$/i.test(edition.key || ''));
    const normalizedTitle = (edition: any) => String(edition.title || '').trim().toLocaleLowerCase();
    const languageEntries = language
      ? entries.filter((edition: any) =>
          (edition.languages || []).some((item: any) =>
            String(item.key || '').split('/').pop() === language,
          ),
        )
      : entries;
    const newestWithCover = (candidates: any[]) => {
      const withCovers = candidates.filter((edition: any) =>
        Array.isArray(edition.covers) && edition.covers.some((coverId: any) => Number(coverId) > 0),
      );
      const editionsToRank = withCovers.length > 0 ? withCovers : candidates;
      const publicationTime = (edition: any) => {
        const dates = Array.isArray(edition.publish_date)
          ? edition.publish_date
          : [edition.publish_date];
        const parsedDates = dates
          .map((date: any) => Date.parse(String(date || '')))
          .filter(Number.isFinite);
        if (parsedDates.length > 0) return Math.max(...parsedDates);
        const year = String(dates[0] || '').match(/\b\d{4}\b/)?.[0];
        return year ? Date.UTC(Number(year), 0, 1) : 0;
      };
      return [...editionsToRank].sort((first: any, second: any) =>
        publicationTime(second) - publicationTime(first),
      )[0] || null;
    };
    const titleMatches = languageEntries.filter(
      (edition: any) => normalizedTitle(edition).includes(normalizedQuery),
    );
    if (preferNewest) return newestWithCover(titleMatches) || newestWithCover(languageEntries);
    return (
      (language ? newestWithCover(languageEntries) : null) ||
      newestWithCover(titleMatches) ||
      null
    );
  } catch {
    return null;
  }
}

const languageEditionCache = new Map<string, { expiresAt: number; edition: any | null }>();
const searchResponseCache = new Map<string, { expiresAt: number; data: any }>();

async function fetchOpenLibrarySearch(apiUrl: string) {
  const cached = searchResponseCache.get(apiUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
      if (response.ok) {
        const data = await response.json();
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

async function findEditionInLanguage(workKey: string, language: string) {
  const cacheKey = `${workKey}:${language}`;
  const cached = languageEditionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.edition;

  const edition = await findMatchingEdition(workKey, '', language, 2500);
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
  const requestedLimit = parseInt(url.searchParams.get('limit') || '16', 10);
  const limit = requestedLimit === 15 ? 15 : 16;
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
    const searchParams = new URLSearchParams({
      [searchField]: isIsbnSearch ? normalizedIsbn : authorKey || query,
      fields: 'title,subtitle,author_name,author_key,language,first_publish_year,cover_i,isbn,key,edition_key,edition_count',
      limit: String(shouldSort || authorExact || language || discoverLanguages ? 1000 : limit),
      offset: String(shouldSort || authorExact || language || discoverLanguages ? 0 : offset),
    });
    const apiUrl = `https://openlibrary.org/search.json?${searchParams}`;
    const data = await fetchOpenLibrarySearch(apiUrl);

    if (!data) {
      return new Response(
        JSON.stringify({ books: [], totalResults: 0, page, totalPages: 0, searchUnavailable: true }),
        { status: 200, headers: jsonHeaders }
      );
    }
    let isbnEdition: any = null;
    if (isIsbnSearch) {
      const isbnController = new AbortController();
      const isbnTimeout = setTimeout(() => isbnController.abort(), 8000);
      try {
        const isbnResponse = await fetch(`https://openlibrary.org/isbn/${normalizedIsbn}.json`, {
          signal: isbnController.signal,
          headers: { 'User-Agent': 'my-book-library/0.0.1' },
        });
        if (isbnResponse.ok) isbnEdition = await isbnResponse.json();
      } catch {
        // Keep the ISBN work result usable if edition lookup is unavailable.
      } finally {
        clearTimeout(isbnTimeout);
      }
    }
    // OpenLibrary's general "q" search matches loosely across unrelated fields
    // (e.g. subjects and contributor notes). Prefer results where the full phrase
    // appears in the title, subtitle, or an author's name, but retain top-ranked
    // results when no visible text matches (for alternate or translated titles).
    const isGeneralQuery = !authorKey && !authorOnly && query.trim().split(/\s+/).length > 1;
    const normalizedPhrase = query.trim().toLocaleLowerCase();
    const topRankedCount = 5;
    const docs = data.docs || [];
    const phraseMatches = docs.filter((doc: any) => {
      const title = String(doc.title || '').toLocaleLowerCase();
      const subtitle = String(doc.subtitle || '').toLocaleLowerCase();
      const authors = (doc.author_name || []) as string[];
      return (
        title.includes(normalizedPhrase) ||
        subtitle.includes(normalizedPhrase) ||
        authors.some((name) => name.toLocaleLowerCase().includes(normalizedPhrase))
      );
    });
    let relevantDocs = isGeneralQuery
      ? phraseMatches.length > 0
        ? phraseMatches
        : docs.slice(0, topRankedCount)
      : docs;
    const fallbackEditionMatches = new Map<string, any>();
    if (isGeneralQuery && phraseMatches.length === 0) {
      const editionMatches = await Promise.all(
        relevantDocs.map((doc: any) =>
          doc.key
            ? findMatchingEdition(String(doc.key).replace(/^\/+/, ''), normalizedPhrase)
            : null,
        ),
      );
      relevantDocs.forEach((doc: any, index: number) => {
        if (doc.key) fallbackEditionMatches.set(String(doc.key), editionMatches[index]);
      });
      if (editionMatches.some(Boolean)) {
        relevantDocs = relevantDocs.filter((doc: any) => fallbackEditionMatches.get(String(doc.key)));
      }
    }
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
      const editions = await Promise.all(titleCandidates.map(({ doc }: any) => {
        const docKey = String(doc.key);
        return fallbackEditionMatches.has(docKey)
          ? fallbackEditionMatches.get(docKey)
          : findMatchingEdition(docKey.replace(/^\/+/, ''), normalizedPhrase, undefined, 2500, true);
      }));
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
        const editions = await Promise.all(batch.map((doc: any) =>
          findEditionInLanguage(String(doc.key).replace(/^\/+/, ''), language),
        ));
        batch.forEach((doc: any, index: number) => {
          if (editions[index]) languageEditionMatches.set(String(doc.key), editions[index]);
        });
      }
    }
    const languageOptions = Array.from(new Set([
      ...authorMatchingDocs.flatMap((doc: any) => doc.language || []),
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
    const sortedDocs = shouldSort
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
    const totalResults = authorExact || shouldSort || language || discoverLanguages
      ? sortedDocs.length
      : data.numFound || 0;
    const totalPages = Math.ceil(totalResults / limit);
    const pageDocs = authorExact || shouldSort || language || discoverLanguages
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
      ? await Promise.all(
          editionLookupDocs.map((doc: any) => {
            if (!doc.key) return null;
            const docKey = String(doc.key);
            if (language) {
              return findMatchingEdition(docKey.replace(/^\/+/, ''), normalizedPhrase, language, 2500, true);
            }
            return fallbackEditionMatches.get(docKey) || titleEditionMatches.get(docKey) || null;
          }),
        )
      : pageDocs.map(() => null);

    const formattedBooks = pageDocs.map((doc: any, index: number) => {
      const edition = matchedEditions[index];
      const selectedEditionId = String(edition?.key || (!isIsbnSearch ? doc.edition_key?.[0] : '') || '')
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
          : doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : null,
      };
    });

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
    return new Response(
      JSON.stringify({ books: [], totalResults: 0, page, totalPages: 0, searchUnavailable: true }),
      { status: 200, headers: jsonHeaders }
    );
  }
};