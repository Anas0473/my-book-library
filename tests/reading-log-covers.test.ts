import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/pages/api/openlibrary-reading-log.json';

test('sync uses current edition covers, preserves logged identity and reports failed lookups', async () => {
  const originalFetch = globalThis.fetch;
  let mode = 'covered';
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname.startsWith('/people/')) {
      const entries = url.pathname.includes('/want-to-read.')
        && url.searchParams.get('page') === '1'
        ? [{
          work: {
            key: '/works/OL46026463W', title: 'Politikens Filosofileksikon',
            cover_id: 15258954,
          },
          logged_edition: '/books/OL62599958M',
          logged_date: '2026/10/02, 10:00:00',
        }]
        : [];
      return Response.json({ reading_log_entries: entries });
    }
    if (url.pathname === '/api/books') {
      assert.equal(url.searchParams.get('bibkeys'), 'OLID:OL62599958M');
      assert.equal(url.searchParams.get('jscmd'), 'details');
      assert.equal(init?.cache, 'no-store');
      if (mode === 'failed') return new Response('', { status: 503 });
      if (mode === 'missing') return Response.json({});
      return Response.json({
        'OLID:OL62599958M': {
          details: {
            key: '/books/OL62599958M', title: 'Politikens Filosofileksikon',
            covers: mode === 'coverless' ? [-1] : [-1, 15261064, 15258954],
            publish_date: '2014', languages: [{ key: '/languages/dan' }],
            isbn_13: ['9788740021721'], publishers: ['Politiken'],
          },
        },
      });
    }
    if (url.pathname.endsWith('/editions.json')) {
      return Response.json({
        entries: [{
          key: '/books/OL2M', title: 'Covered replacement', covers: [999],
          publish_date: '2020', publishers: ['Test publisher'],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const sync = async () => GET({
    url: new URL('http://localhost/api/openlibrary-reading-log.json?username=tester'),
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof GET>[0]);

  try {
    let response = await sync();
    assert.equal(response.status, 200);
    let data = await response.json();
    assert.equal(data.books.length, 1);
    assert.equal(data.books[0].editionHeroImage, 'https://covers.openlibrary.org/b/id/15261064-M.jpg');
    assert.equal(data.books[0].editionKey, '/books/OL62599958M');
    assert.equal(data.books[0].loggedEditionKey, '/books/OL62599958M');
    assert.equal(data.books[0].editionLanguage, 'dan');
    assert.equal(data.books[0].isbn, '9788740021721');
    assert.equal(data.books[0].publisher, 'Politiken');
    assert.equal(data.books[0].status, 'Plan to Read');
    assert.ok(!requests.includes('/search.json'), 'sync must not use the stale search index');

    mode = 'coverless';
    response = await sync();
    data = await response.json();
    assert.equal(data.books[0].editionKey, '/books/OL2M');
    assert.equal(data.books[0].loggedEditionKey, '/books/OL62599958M');
    assert.equal(data.books[0].editionHeroImage, 'https://covers.openlibrary.org/b/id/999-M.jpg');

    for (mode of ['failed', 'missing']) {
      response = await sync();
      assert.equal(response.status, 502);
      data = await response.json();
      assert.ok(data.error);
      assert.equal(data.books, undefined, 'failed sync must not return replacement books');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
