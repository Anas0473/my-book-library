import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify([]), { status: 200 });
  }

  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`
    );
    const data = await res.json();

    const formattedBooks = data.docs.map((book: any) => ({
      id: book.key,
      title: book.title,
      author: book.author_name ? book.author_name.join(', ') : 'Unknown Author',
      pubDate: book.first_publish_year || 'N/A',
      heroImage: book.cover_i
        ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
        : null,
      isbn: book.isbn ? book.isbn[0] : null,
    }));

    return new Response(JSON.stringify(formattedBooks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch books' }), {
      status: 500,
    });
  }
};