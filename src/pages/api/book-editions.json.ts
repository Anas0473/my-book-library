import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const work = url.searchParams.get('work')?.trim();
  const title = url.searchParams.get('title')?.trim();
  const author = url.searchParams.get('author')?.trim();
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
      limit: '100',
      fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages',
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
    const editions = (data.entries || [])
      .filter((edition: any) => /^\/books\/OL\d+M$/i.test(edition.key || ''))
      .map((edition: any) => ({
        key: edition.key,
        title: edition.title || 'Untitled edition',
        subtitle: edition.subtitle || null,
        pubDate: edition.publish_date || 'Unknown',
        publisher: edition.publishers?.[0] || 'Unknown publisher',
        language: edition.languages?.[0]?.key?.replace('/languages/', '') || 'Unknown language',
        isbn: edition.isbn_13?.[0] || edition.isbn_10?.[0] || null,
        coverImage: edition.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-M.jpg`
          : null,
        url: `https://openlibrary.org${edition.key}`,
      }));

    return new Response(JSON.stringify({ editions }), {
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
