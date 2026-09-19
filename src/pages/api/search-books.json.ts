import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q');
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

  try {
    const apiUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(
      query
    )}&fields=title,subtitle,author_name,first_publish_year,cover_i,isbn,key&limit=${limit}&offset=${offset}`;

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
    const totalResults = data.numFound || 0;
    const totalPages = Math.ceil(totalResults / limit);

    const formattedBooks = (data.docs || []).map((doc: any) => ({
      key: doc.key,
      title: doc.title,
      subtitle: doc.subtitle || null,
      author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
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