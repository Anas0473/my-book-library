import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q');
  const authorOnly = url.searchParams.get('author') === '1';
  const authorKey = url.searchParams.get('author_key')?.trim();
  const authorExact = url.searchParams.get('author_exact') === '1';
  const language = url.searchParams.get('language')?.trim();
  const discoverLanguages = url.searchParams.get('discover_languages') === '1';
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

    const searchParams = new URLSearchParams({
      [authorKey ? 'author_key' : authorOnly ? 'author' : query.trim().split(/\s+/).length > 1 ? 'q' : 'title']:
        authorKey || query,
      fields: 'title,subtitle,author_name,author_key,language,first_publish_year,cover_i,isbn,key,edition_key',
      limit: String(shouldSort || authorExact || language || discoverLanguages ? 1000 : limit),
      offset: String(shouldSort || authorExact || language || discoverLanguages ? 0 : offset),
    });
    const apiUrl = `https://openlibrary.org/search.json?${searchParams}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ books: [], totalResults: 0, page, totalPages: 0 }),
        { status: 200, headers: jsonHeaders }
      );
    }

    const data = await res.json();
    // OpenLibrary's general "q" search matches loosely across many unrelated fields
    // (e.g. subjects, contributor notes), so require the full phrase to actually
    // appear in the title, subtitle, or a single author's name.
    const isGeneralQuery = !authorKey && !authorOnly && query.trim().split(/\s+/).length > 1;
    const normalizedPhrase = query.trim().toLocaleLowerCase();
    const relevantDocs = isGeneralQuery
      ? (data.docs || []).filter((doc: any) => {
          const title = String(doc.title || '').toLocaleLowerCase();
          const subtitle = String(doc.subtitle || '').toLocaleLowerCase();
          const authors = (doc.author_name || []) as string[];
          return (
            title.includes(normalizedPhrase) ||
            subtitle.includes(normalizedPhrase) ||
            authors.some((name) => name.toLocaleLowerCase().includes(normalizedPhrase))
          );
        })
      : data.docs || [];
    const authorMatchingDocs = authorExact
      ? relevantDocs.filter((doc: any) =>
          (doc.author_name || []).some(
            (name: string) => name.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ),
        )
      : relevantDocs;
    const languageOptions = Array.from(new Set(
      authorMatchingDocs.flatMap((doc: any) => doc.language || []),
    )).sort();
    const matchingDocs = language
      ? authorMatchingDocs.filter((doc: any) => (doc.language || []).includes(language))
      : authorMatchingDocs;
    const sortedDocs = shouldSort
      ? [...matchingDocs].sort((first: any, second: any) => {
          if (sort.startsWith('title')) {
            const comparison = String(first.title || '').localeCompare(
              String(second.title || ''),
              undefined,
              { numeric: true, sensitivity: 'base' },
            );
            return sort === 'title-desc' ? -comparison : comparison;
          }

          const firstYear = Number(first.first_publish_year) || 0;
          const secondYear = Number(second.first_publish_year) || 0;
          return sort === 'year-desc' ? secondYear - firstYear : firstYear - secondYear;
        })
      : matchingDocs;
    const totalResults = authorExact || shouldSort || language || discoverLanguages
      ? sortedDocs.length
      : data.numFound || 0;
    const totalPages = Math.ceil(totalResults / limit);
    const pageDocs = authorExact || shouldSort || language || discoverLanguages
      ? sortedDocs.slice(offset, offset + limit)
      : sortedDocs;

    const formattedBooks = pageDocs.map((doc: any) => ({
      key: doc.key,
      workKey: doc.key,
      title: doc.title,
      subtitle: doc.subtitle || null,
      author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
      authorKeys: doc.author_key || [],
      editionKeys: doc.edition_key || [],
      languages: doc.language || [],
      pubDate: doc.first_publish_year || 'Unknown',
      isbn: doc.isbn ? doc.isbn[0] : null,
      heroImage: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : null,
    }));

    return new Response(
      JSON.stringify({
        books: formattedBooks,
        totalResults,
        page,
        totalPages,
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
      JSON.stringify({ books: [], totalResults: 0, page, totalPages: 0 }),
      { status: 200, headers: jsonHeaders }
    );
  }
};