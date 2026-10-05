import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/pages/api/recommended-books.json.ts';

const getRecommendations = (seeds: string[], languages: string[] = []) => {
  const params = new URLSearchParams();
  seeds.forEach((seed) => params.append('seed', seed));
  languages.forEach((language) => params.append('language', language));
  return GET({ url: new URL(`http://localhost/api/recommended-books.json?${params}`) } as Parameters<typeof GET>[0]);
};

test('recommendations use shared subjects, rank overlaps and omit books already on the list', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/works/OL1W.json') {
      return Response.json({ subjects: ['Space travel', 'Fiction', 'Space travel'] });
    }
    if (url.pathname === '/works/OL2W.json') {
      return Response.json({ subjects: ['Space travel', 'Robots'] });
    }
    if (url.pathname.startsWith('/subjects/')) {
      const subject = url.pathname.split('/').pop();
      const works = subject === 'space_travel.json'
        ? [
            { key: '/works/OL1W', title: 'Already read', edition_count: 30 },
            {
              key: '/works/OL3W', title: 'Space and Robots', edition_count: 3,
              cover_id: 123, first_publish_year: 2020,
              authors: [{ key: '/authors/OL4A', name: 'A. Writer' }],
            },
            { key: '/works/OL5W', title: 'Space only', edition_count: 100 },
          ]
        : [
            { key: '/works/OL3W', title: 'Space and Robots', edition_count: 3 },
            { key: '/works/OL6W', title: 'Robot story', edition_count: 2 },
          ];
      return Response.json({ works });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await getRecommendations(['/works/OL1W', '/works/OL2W']);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.books.map((book: any) => book.key), ['/works/OL3W', '/works/OL5W', '/works/OL6W']);
    assert.equal(data.books[0].author, 'A. Writer');
    assert.equal(data.books[0].heroImage, 'https://covers.openlibrary.org/b/id/123-M.jpg');
    assert.ok(requests.includes('/subjects/space_travel.json'));
    assert.ok(!requests.includes('/subjects/fiction.json'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recommendations can resolve edition seeds to their work', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/books/OL10M.json') return Response.json({ works: [{ key: '/works/OL10W' }] });
    if (url.pathname === '/works/OL10W.json') return Response.json({ subjects: ['Mystery'] });
    if (url.pathname === '/subjects/mystery.json') {
      return Response.json({ works: [{ key: '/works/OL11W', title: 'Another mystery' }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await getRecommendations(['/books/OL10M']);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.books[0].key, '/works/OL11W');
    assert.ok(requests.includes('/books/OL10M.json'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recommendations match available editions to the languages in the reader’s lists', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/works/OL20W.json') return Response.json({ subjects: ['Historical fiction'] });
    if (url.pathname === '/subjects/historical_fiction.json') {
      return Response.json({
        works: [
          { key: '/works/OL21W', title: 'Danish translation', edition_count: 20 },
          { key: '/works/OL22W', title: 'Russian only', edition_count: 30 },
        ],
      });
    }
    if (url.pathname === '/works/OL21W/editions.json') {
      return Response.json({
        entries: [
          {
            key: '/books/OL21M',
            title: 'Danish translation',
            languages: [{ key: '/languages/dan' }],
            covers: [210],
            publish_date: '2020',
            isbn_13: ['9780000000021'],
          },
          {
            key: '/books/OL23M',
            title: 'Russian translation',
            languages: [{ key: '/languages/rus' }],
            covers: [230],
            publish_date: '2024',
          },
        ],
      });
    }
    if (url.pathname === '/works/OL22W/editions.json') {
      return Response.json({
        entries: [{
          key: '/books/OL22M',
          title: 'Russian only',
          languages: [{ key: '/languages/rus' }],
          covers: [220],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await getRecommendations(['/works/OL20W'], ['dan', 'eng']);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.books.map((book: any) => book.title), ['Danish translation']);
    assert.equal(data.books[0].editionLanguage, 'dan');
    assert.equal(data.books[0].editionKey, '/books/OL21M');
    assert.equal(
      requests.filter((path) => path.endsWith('/editions.json')).length,
      2,
      'each candidate is checked once regardless of the number of preferred languages',
    );
    const requestCountAfterFirstLoad = requests.length;
    const cachedResponse = await getRecommendations(['/works/OL20W'], ['dan', 'eng']);
    assert.equal(cachedResponse.status, 200);
    assert.equal(requests.length, requestCountAfterFirstLoad, 'repeat recommendations should use the result cache');
    assert.ok(requests.includes('/works/OL22W/editions.json'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recommendations return up to 40 language-matched books from a larger candidate pool', async () => {
  const originalFetch = globalThis.fetch;
  const editionRequests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/works/OL30W.json') {
      return Response.json({ subjects: ['Classic adventure'] });
    }
    if (url.pathname === '/subjects/classic_adventure.json') {
      return Response.json({
        works: Array.from({ length: 65 }, (_, index) => ({
          key: `/works/OL${100 + index}W`,
          title: `Adventure ${String(index + 1).padStart(2, '0')}`,
          edition_count: 100 - index,
        })),
      });
    }
    const match = url.pathname.match(/^\/works\/OL(\d+)W\/editions\.json$/);
    if (match) {
      editionRequests.push(url.pathname);
      const workNumber = Number(match[1]);
      return Response.json({
        entries: [{
          key: `/books/OL${workNumber}M`,
          title: `Adventure ${workNumber - 99}`,
          languages: [{ key: `/languages/${workNumber % 7 === 0 ? 'rus' : 'dan'}` }],
          covers: [workNumber],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await getRecommendations(['/works/OL30W'], ['dan', 'eng']);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.books.length, 40);
    assert.ok(data.books.every((book: any) => book.editionLanguage === 'dan'));
    assert.equal(editionRequests.length, 60, 'the expanded candidate pool is checked');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed candidate edition lookup returns other matches instead of failing all recommendations', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/works/OL40W.json') {
      return Response.json({ subjects: ['Detective fiction'] });
    }
    if (url.pathname === '/subjects/detective_fiction.json') {
      return Response.json({
        works: [
          { key: '/works/OL41W', title: 'Available detective book' },
          { key: '/works/OL42W', title: 'Unavailable detective book' },
        ],
      });
    }
    if (url.pathname === '/works/OL41W/editions.json') {
      return Response.json({
        entries: [{
          key: '/books/OL41M',
          title: 'Available detective book',
          languages: [{ key: '/languages/dan' }],
        }],
      });
    }
    if (url.pathname === '/works/OL42W/editions.json') {
      return new Response('', { status: 503 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await getRecommendations(['/works/OL40W'], ['dan']);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.partial, true);
    assert.deepEqual(data.books.map((book: any) => book.title), ['Available detective book']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recommendations reject missing, excessive and invalid seed IDs', async () => {
  const empty = await getRecommendations([]);
  assert.equal(empty.status, 400);
  const invalid = await getRecommendations(['/authors/OL1A']);
  assert.equal(invalid.status, 400);
  const excessive = await getRecommendations(Array.from({ length: 13 }, (_, index) => `/works/OL${index + 1}W`));
  assert.equal(excessive.status, 400);
});
