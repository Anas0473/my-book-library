import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/pages/api/search-books.json';

test('search falls back on outages, but not on genuinely missing covers', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let mode = 'healthy';
  let searchRequests = 0;
  let fullSearchRequests = 0;
  let probeRequests = 0;
  let editionFailed = false;
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
      const params = new URL(url).searchParams;
      const isProbe = params.get('fields') === 'key';
      if (isProbe) {
        probeRequests++;
        assert.equal(params.get('limit'), '1');
        assert.equal(params.get('offset'), '0');
      } else {
        fullSearchRequests++;
      }
      if (mode === 'search-down' || mode === 'both-down') {
        return new Response('', { status: 503 });
      }
      if (mode === 'network-down') throw new TypeError('Network unavailable');
      if (mode === 'probe-timeout' && isProbe) {
        throw new DOMException('Timed out', 'AbortError');
      }
      if (mode === 'probe-malformed' && isProbe) return Response.json({ error: 'Unavailable' });
      if (mode === 'outage-after-search' && editionFailed && isProbe) {
        return new Response('', { status: 503 });
      }
      if (isProbe) return Response.json({ numFound: 1, docs: [{ key: '/works/OL1W' }] });
      return Response.json({
        numFound: 1,
        docs: [{
          key: '/works/OL1W', title: 'Test book', edition_key: ['OL1M'],
          first_publish_year: 2000, cover_i: 123,
        }],
      });
    }
    if (mode === 'editions-down') return new Response('', { status: 503 });
    if (mode === 'edition-rate-limit') return new Response('', { status: 429 });
    if (mode === 'outage-after-search') {
      editionFailed = true;
      return new Response('', { status: 503 });
    }
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

    const fullBefore = fullSearchRequests;
    const probesBefore = probeRequests;
    const cached = await search('Test');
    assert.deepEqual(cached, healthy, 'cached results retain full metadata, not probe data');
    assert.equal(fullSearchRequests, fullBefore, 'healthy repeat search reuses cached results');
    assert.equal(probeRequests, probesBefore + 1, 'cached results require a live check');

    mode = 'search-down';
    const before = searchRequests;
    const unavailable = await search('Test');
    assert.ok(searchRequests > before, 'repeat search must not hide an outage behind cached results');
    assert.equal(unavailable.searchProvider, 'internet-archive');
    assert.equal(unavailable.books[0].provider, 'internet-archive');
    assert.equal(unavailable.books[0].workKey, null);

    for (const failure of ['network-down', 'probe-timeout', 'probe-malformed']) {
      mode = failure;
      const data = await search('Test');
      assert.equal(data.searchProvider, 'internet-archive', failure);
      assert.equal(fullSearchRequests, fullBefore, 'failed probe never serves or refetches full results');
    }

    for (const failure of ['editions-down', 'edition-timeout', 'edition-rate-limit']) {
      mode = failure;
      const data = await search(`Test-${failure}`);
      assert.equal(data.searchProvider, undefined, 'an edition failure is not a search outage');
      assert.equal(data.books.length, 1);
      assert.equal(data.books[0].workKey, '/works/OL1W');
      assert.equal(data.books[0].heroImage, 'https://covers.openlibrary.org/b/id/123-M.jpg');
    }

    mode = 'outage-after-search';
    const midSearchOutage = await search('Test-outage-after-search');
    assert.equal(midSearchOutage.searchProvider, 'internet-archive');

    mode = 'both-down';
    const bothDown = await search('Different-query');
    assert.equal(bothDown.searchUnavailable, true);
    assert.deepEqual(bothDown.books, []);

    mode = 'healthy';
    const recovered = await search('Test');
    assert.equal(recovered.searchProvider, undefined);
    assert.equal(recovered.books[0].workKey, '/works/OL1W');

    const fullBeforeExpiry = fullSearchRequests;
    Date.now = () => originalNow() + 11 * 60 * 1000;
    const refreshed = await search('Test');
    assert.equal(refreshed.searchProvider, undefined);
    assert.equal(fullSearchRequests, fullBeforeExpiry + 1, 'expired results must be fetched again');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
