import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify([]), { status: 200 });
  }

  try {
    // Increased limit to 16 to complete 2 full grid rows
    const apiUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(
      query
    )}&fields=title,author_name,first_publish_year,cover_i,isbn,key&limit=16`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    const data = await res.json();

    const formattedBooks = (data.docs || []).map((doc: any) => ({
      key: doc.key,
      title: doc.title,
      author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
      pubDate: doc.first_publish_year || 'Unknown',
      isbn: doc.isbn ? doc.isbn[0] : null,
      heroImage: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : null,
    }));

    // Sort the 16 items alphabetically by title (A to Z)
    formattedBooks.sort((a: any, b: any) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    );

    return new Response(JSON.stringify(formattedBooks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('API Fetch error:', error);
    return new Response(JSON.stringify([]), { status: 200 });
  }
};