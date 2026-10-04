import type { APIRoute } from 'astro';

const EDITIONS_PAGE_SIZE = 1000;
// A safety cap for works with an extreme number of editions.
const MAX_EDITIONS = 20000;

function unavailableResponse() {
  return new Response(JSON.stringify({ editions: [], searchUnavailable: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const work = url.searchParams.get('work')?.trim();
  const title = url.searchParams.get('title')?.trim();
  const author = url.searchParams.get('author')?.trim();
  const preferredEdition = url.searchParams.get('preferred_edition')?.trim() || '';
  const language = url.searchParams.get('language')?.trim() || '';
  let workKey = work?.replace(/^\/+/, '');

  if (workKey && !/^works\/OL\d+W$/i.test(workKey)) {
    return new Response(JSON.stringify({ editions: [] }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (!workKey && title) {
      const searchParams = new URLSearchParams({
        q: author ? `title:"${title}" AND author:"${author}"` : `title:"${title}"`,
        fields: 'key',
        limit: '1',
      });
      const searchResponse = await fetch(`https://openlibrary.org/search.json?${searchParams}`, {
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
      if (!searchResponse.ok) return unavailableResponse();
      const searchData = await searchResponse.json();
      workKey = searchData.docs?.[0]?.key?.replace(/^\/+/, '');
    }

    if (!workKey || !/^works\/OL\d+W$/i.test(workKey)) {
      return new Response(JSON.stringify({ editions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fetchEditionPage = async (offset: number) => {
      const params = new URLSearchParams({
        limit: String(EDITIONS_PAGE_SIZE),
        offset: String(offset),
        fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages,ocaid',
      });
      const response = await fetch(`https://openlibrary.org/${workKey}/editions.json?${params}`, {
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
      if (!response.ok) throw new Error(`Open Library responded with ${response.status}`);
      return response.json();
    };

    let data: any;
    try {
      data = await fetchEditionPage(0);
    } catch {
      return unavailableResponse();
    }
    // Open Library returns at most 1000 editions per request, so fetch the rest in parallel.
    const reportedCount = Number(data.size) || 0;
    const fetchCount = Math.min(reportedCount, MAX_EDITIONS);
    const remainingOffsets = [];
    for (let offset = EDITIONS_PAGE_SIZE; offset < fetchCount; offset += EDITIONS_PAGE_SIZE) {
      remainingOffsets.push(offset);
    }
    const remainingPages = await Promise.allSettled(remainingOffsets.map(fetchEditionPage));
    const entries = [
      ...(data.entries || []),
      ...remainingPages.flatMap((page) => (page.status === 'fulfilled' ? page.value.entries || [] : [])),
    ];
    const seenEditionKeys = new Set<string>();
    const allEditions = entries
      .filter((edition: any) => !seenEditionKeys.has(edition?.key) && seenEditionKeys.add(edition?.key))
      .filter((edition: any) => /^\/books\/OL\d+M$/i.test(edition.key || ''))
      .map((edition: any) => ({
        key: edition.key,
        title: edition.title || 'Untitled edition',
        subtitle: edition.subtitle || null,
        pubDate: edition.publish_date || 'Unknown',
        publisher: edition.publishers?.[0] || 'Unknown publisher',
        language: edition.languages?.[0]?.key?.replace('/languages/', '') || 'Unknown language',
        isbn: edition.isbn_13?.[0] || edition.isbn_10?.[0] || null,
        hasDigitalCopy: Boolean(edition.ocaid),
        coverImage: edition.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-M.jpg`
          : null,
        url: `https://openlibrary.org${edition.key}`,
      }));
    const normalizeEditionKey = (key: string) =>
      String(key || '').match(/OL\d+M/i)?.[0].toUpperCase() || String(key || '').replace(/^\/+|\/+$/g, '');
    const preferredId = normalizeEditionKey(preferredEdition);
    const publicationTime = (edition: any) => {
      const dates = Array.isArray(edition.pubDate) ? edition.pubDate : [edition.pubDate];
      const parsed = dates
        .map((date: any) => Date.parse(String(date || '')))
        .filter(Number.isFinite);
      if (parsed.length > 0) return Math.max(...parsed);
      const year = String(dates[0] || '').match(/\b\d{4}\b/)?.[0];
      return year ? Date.UTC(Number(year), 0, 1) : 0;
    };
    const publicationTimes = new Map<object, number>();
    for (const edition of allEditions) {
      publicationTimes.set(edition, publicationTime(edition));
    }
    const compareEditions = (first: any, second: any) => {
      const firstHasCover = Boolean(first.coverImage);
      const secondHasCover = Boolean(second.coverImage);
      if (firstHasCover !== secondHasCover) return firstHasCover ? -1 : 1;

      const firstInLanguage = language && first.language === language;
      const secondInLanguage = language && second.language === language;
      if (firstInLanguage !== secondInLanguage) return firstInLanguage ? -1 : 1;
      return publicationTimes.get(second)! - publicationTimes.get(first)!
        || first.title.localeCompare(second.title, undefined, { sensitivity: 'base' });
    };
    const selectedEdition = allEditions.find(
      (edition: any) => preferredId && normalizeEditionKey(edition.key) === preferredId,
    );
    const rankedEditions = [
      ...allEditions.filter((edition: any) => edition.hasDigitalCopy).sort(compareEditions),
      ...allEditions.filter((edition: any) => !edition.hasDigitalCopy).sort(compareEditions),
    ];
    const featuredEditions = selectedEdition
      ? [
          selectedEdition,
          ...rankedEditions.filter((edition: any) => normalizeEditionKey(edition.key) !== preferredId),
        ].slice(0, 10)
      : rankedEditions.slice(0, 10);
    const featuredKeys = new Set(featuredEditions.map((edition: any) => edition.key));
    const editions = [
      ...featuredEditions,
      ...allEditions.filter((edition: any) => !featuredKeys.has(edition.key)).sort(compareEditions),
    ];
    // The count matches the editions that can actually be shown and paged through.
    const totalCount = allEditions.length;

    return new Response(JSON.stringify({ editions, featuredCount: featuredEditions.length, totalCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return unavailableResponse();
  }
};
