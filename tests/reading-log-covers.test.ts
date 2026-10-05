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
      if (mode === 'timeout') throw new DOMException('Request timed out', 'AbortError');
      return Response.json({
        'OLID:OL62599958M': {
          details: {
            key: mode === 'wrong-edition' ? '/books/OL1M' : '/books/OL62599958M',
            title: 'Politikens Filosofileksikon',
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

    for (mode of ['failed', 'missing', 'wrong-edition', 'timeout']) {
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

test('sync refreshes all 238 editions in five batches and rejects failures in the last batch', async () => {
  const originalFetch = globalThis.fetch;
  let mode = 'success';
  const batches: string[][] = [];
  const statuses = ['Plan to Read', 'Reading', 'Read'];
  const shelves = ['want-to-read', 'currently-reading', 'already-read'];
  const entries = Array.from({ length: 238 }, (_, index) => ({
    work: {
      key: `/works/OL${index + 1}W`,
      title: `Work ${index + 1}`,
      cover_id: index + 1,
      author_names: [`Author ${index + 1}`],
      first_publish_year: 1900,
    },
    logged_edition: `/books/OL${index + 1}M`,
    logged_date: '2026/10/02, 10:00:00',
  }));
  const expectedBooks = entries.map((entry, index) => ({
    key: entry.work.key,
    workKey: entry.work.key,
    editionKey: entry.logged_edition,
    loggedEditionKey: entry.logged_edition,
    editionUrl: `https://openlibrary.org${entry.logged_edition}`,
    editionHeroImage: `https://covers.openlibrary.org/b/id/${index + 1000}-M.jpg`,
    title: `Edition ${index + 1}`,
    workTitle: entry.work.title,
    subtitle: `Subtitle ${index + 1}`,
    author: entry.work.author_names.join(', '),
    pubDate: '2020',
    isbn: `isbn-${index + 1}`,
    heroImage: `https://covers.openlibrary.org/b/id/${entry.work.cover_id}-M.jpg`,
    status: statuses[Math.floor(index / 100)],
    dateAdded: Date.UTC(2026, 9, 2, 10),
    editionLanguage: 'eng',
    publisher: `Publisher ${index + 1}`,
  }));

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/people/')) {
      const shelfIndex = shelves.findIndex((shelf) => url.pathname.endsWith(`/${shelf}.json`));
      assert.notEqual(shelfIndex, -1);
      const page = Number(url.searchParams.get('page'));
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        reading_log_entries: page === 1 ? entries.slice(shelfIndex * 100, (shelfIndex + 1) * 100) : [],
      });
    }
    assert.equal(url.pathname, '/api/books');
    assert.equal(url.searchParams.get('jscmd'), 'details');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.signal?.aborted, false);
    const ids = url.searchParams.get('bibkeys')!.split(',');
    batches.push(ids);
    if (batches.length >= 5 && mode === 'failed') return new Response('', { status: 503 });
    const details = Object.fromEntries(ids.map((id) => {
      const number = Number(id.match(/^OLID:OL(\d+)M$/)![1]);
      return [id, {
        details: {
          key: `/books/OL${number}M`,
          title: `Edition ${number}`,
          subtitle: `Subtitle ${number}`,
          publish_date: ['2020'],
          covers: [-1, number + 999],
          languages: [{ key: '/languages/eng' }],
          isbn_13: [`isbn-${number}`],
          publishers: [`Publisher ${number}`],
        },
      }];
    }));
    if (batches.length === 5 && mode === 'missing') delete details[ids[ids.length - 1]];
    return Response.json(details);
  };

  try {
    for (mode of ['success', 'failed', 'missing']) {
      batches.length = 0;
      const response = await GET({
        url: new URL('http://localhost/api/openlibrary-reading-log.json?username=tester'),
        cookies: { get: () => undefined },
      } as unknown as Parameters<typeof GET>[0]);
      const data = await response.json();
      assert.deepEqual(batches.map((batch) => batch.length),
        mode === 'failed' ? [50, 50, 50, 50, 38, 38] : [50, 50, 50, 50, 38]);
      assert.equal(new Set(batches.flat()).size, 238);
      if (mode === 'success') {
        assert.equal(response.status, 200);
        assert.deepEqual(data.books, expectedBooks);
        assert.equal(data.truncated, false);
        assert.deepEqual(data.incompleteShelves, []);
      } else {
        assert.equal(response.status, 502);
        assert.equal(data.error, 'Could not sync the Open Library reading log. Please try again.');
        assert.equal(data.books, undefined, 'a late failure must not return partially refreshed books');
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shelf timeouts retry once, but malformed shelf pages never become an empty successful sync', async () => {
  const originalFetch = globalThis.fetch;
  let mode = 'recover';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (mode === 'timeout' || (mode === 'recover' && calls === 1)) {
      throw new DOMException('Request timed out', 'AbortError');
    }
    return Response.json(mode === 'malformed' ? {} : { reading_log_entries: [] });
  };
  try {
    for (mode of ['recover', 'timeout', 'malformed']) {
      calls = 0;
      const response = await GET({
        url: new URL('http://localhost/api/openlibrary-reading-log.json?username=tester'),
        cookies: { get: () => undefined },
      } as unknown as Parameters<typeof GET>[0]);
      const data = await response.json();
      if (mode === 'recover') {
        assert.equal(calls, 4, 'one retried shelf and two other shelves');
        assert.equal(response.status, 200);
        assert.deepEqual(data.books, []);
        assert.deepEqual(data.incompleteShelves, []);
      } else {
        assert.equal(calls, mode === 'timeout' ? 2 : 1);
        assert.equal(response.status, 502);
        assert.equal(data.books, undefined);
        if (mode === 'timeout') assert.match(data.error, /even after retrying.*saved books were kept/);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
