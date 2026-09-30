import type { APIRoute } from 'astro';

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
      const searchData = await searchResponse.json();
      workKey = searchData.docs?.[0]?.key?.replace(/^\/+/, '');
    }

    if (!workKey || !/^works\/OL\d+W$/i.test(workKey)) {
      return new Response(JSON.stringify({ editions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const params = new URLSearchParams({
      limit: '1000',
      fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages,ocaid',
    });
    const response = await fetch(`https://openlibrary.org/${workKey}/editions.json?${params}`, {
      headers: { 'User-Agent': 'my-book-library/0.0.1' },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ editions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const allEditions = (data.entries || [])
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
    const compareEditions = (first: any, second: any) => {
      const firstHasCover = Boolean(first.coverImage);
      const secondHasCover = Boolean(second.coverImage);
      if (firstHasCover !== secondHasCover) return firstHasCover ? -1 : 1;

      const firstInLanguage = language && first.language === language;
      const secondInLanguage = language && second.language === language;
      if (firstInLanguage !== secondInLanguage) return firstInLanguage ? -1 : 1;
      return publicationTime(second) - publicationTime(first)
        || first.title.localeCompare(second.title, undefined, { sensitivity: 'base' });
    };
    const selectedEdition = allEditions.find(
      (edition: any) => preferredId && normalizeEditionKey(edition.key) === preferredId,
    );
    const availableEditions = allEditions
      .filter((edition: any) => edition.hasDigitalCopy)
      .sort(compareEditions);
    const featuredEditions = availableEditions.length > 0
      ? availableEditions.slice(0, 10)
      : [...allEditions].sort(compareEditions).slice(0, 10);
    if (selectedEdition) {
      const selectedIndex = featuredEditions.findIndex(
        (edition: any) => normalizeEditionKey(edition.key) === preferredId,
      );
      if (selectedIndex >= 0) featuredEditions.splice(selectedIndex, 1);
      featuredEditions.unshift(selectedEdition);
    }
    const featuredKeys = new Set(featuredEditions.map((edition: any) => edition.key));
    const editions = [
      ...featuredEditions,
      ...allEditions.filter((edition: any) => !featuredKeys.has(edition.key)).sort(compareEditions),
    ];
    const totalCount = Number(data.size) || allEditions.length;

    return new Response(JSON.stringify({ editions, featuredCount: featuredEditions.length, totalCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ editions: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
