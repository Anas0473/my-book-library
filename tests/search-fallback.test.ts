import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/pages/api/search-books.json';

test('search falls back on outages, but not on genuinely missing covers', async () => {
  const originalFetch = globalThis.fetch;
  let mode = 'healthy';
  let searchRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://archive.org/')) {
      if (mode === 'both-down') return new Response('', { status: 503 });
      return Response.json({
        response: {
          numFound: 1,
          docs: [{ identifier: 'archive-book', title: 'Archive book', year: 2020 }],
        },
      });
    }
    if (url.includes('/search.json')) {
      searchRequests++;
      if (mode === 'search-down' || mode === 'both-down') {
        return new Response('', { status: 503 });
      }
      if (mode === 'network-down') throw new TypeError('Network unavailable');
      return Response.json({
        numFound: 1,
        docs: [{
          key: '/works/OL1W', title: 'Test book', edition_key: ['OL1M'],
          first_publish_year: 2000, cover_i: 123,
        }],
      });
    }
    if (mode === 'editions-down') return new Response('', { status: 503 });
    if (mode === 'edition-timeout') throw new DOMException('Timed out', 'AbortError');
    if (url.includes('/editions.json')) {
      return Response.json({
        entries: [{ key: '/books/OL1M', title: 'Test book', publish_date: '2000' }],
      });
    }
    return new Response('', { status: 404 });
  };

  const search = async (query: string) => {
    const context = { url: new URL(`http://localhost/api/search-books.json?q=${query}`) };
    const response = await GET(context as Parameters<typeof GET>[0]);
    return response.json();
  };

  try {
    const healthy = await search('Test');
    assert.equal(healthy.searchProvider, undefined);
    assert.equal(healthy.books[0].workKey, '/works/OL1W');

    mode = 'search-down';
    const before = searchRequests;
    const unavailable = await search('Test');
    assert.ok(searchRequests > before, 'repeat search must not hide an outage behind cached results');
    assert.equal(unavailable.searchProvider, 'internet-archive');
    assert.equal(unavailable.books[0].provider, 'internet-archive');
    assert.equal(unavailable.books[0].workKey, null);

    for (const failure of ['editions-down', 'edition-timeout', 'network-down']) {
      mode = failure;
      const data = await search(`Test-${failure}`);
      assert.equal(data.searchProvider, 'internet-archive', failure);
      assert.equal(data.books.length, 1);
    }

    mode = 'both-down';
    const bothDown = await search('Different-query');
    assert.equal(bothDown.searchUnavailable, true);
    assert.deepEqual(bothDown.books, []);

    mode = 'healthy';
    const recovered = await search('Test');
    assert.equal(recovered.searchProvider, undefined);
    assert.equal(recovered.books[0].workKey, '/works/OL1W');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
