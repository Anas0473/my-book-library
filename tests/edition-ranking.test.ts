import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/pages/api/book-editions.json';

const entries = Array.from({ length: 4200 }, (_, index) => ({
  key: `/books/OL${index + 1}M`,
  title: `Edition ${index % 27}`,
  subtitle: index % 3 ? null : 'Subtitle',
  publish_date: index % 7 === 0 ? ['1980', '2000'] : index % 5 === 0 ? 'Unknown' : String(1800 + index % 225),
  publishers: [`Publisher ${index % 11}`],
  languages: [{ key: index % 3 ? '/languages/eng' : '/languages/fre' }],
  isbn_13: [`isbn-${index}`],
  covers: index % 4 ? [index + 1] : [],
  ocaid: index % 6 ? null : `archive-${index}`,
}));

function legacyRanking(preferredId: string, language: string) {
  const editions = entries.map((entry) => ({
    key: entry.key,
    title: entry.title,
    subtitle: entry.subtitle,
    pubDate: entry.publish_date,
    publisher: entry.publishers[0],
    language: entry.languages[0].key.replace('/languages/', ''),
    isbn: entry.isbn_13[0],
    hasDigitalCopy: Boolean(entry.ocaid),
    coverImage: entry.covers[0] ? `https://covers.openlibrary.org/b/id/${entry.covers[0]}-M.jpg` : null,
    url: `https://openlibrary.org${entry.key}`,
  }));
  const publicationTime = (edition: typeof editions[number]) => {
    const dates = Array.isArray(edition.pubDate) ? edition.pubDate : [edition.pubDate];
    const parsed = dates.map((date) => Date.parse(String(date || ''))).filter(Number.isFinite);
    if (parsed.length > 0) return Math.max(...parsed);
    const year = String(dates[0] || '').match(/\b\d{4}\b/)?.[0];
    return year ? Date.UTC(Number(year), 0, 1) : 0;
  };
  const compare = (first: typeof editions[number], second: typeof editions[number]) => {
    if (Boolean(first.coverImage) !== Boolean(second.coverImage)) return first.coverImage ? -1 : 1;
    const firstInLanguage = language && first.language === language;
    const secondInLanguage = language && second.language === language;
    if (firstInLanguage !== secondInLanguage) return firstInLanguage ? -1 : 1;
    return publicationTime(second) - publicationTime(first)
      || first.title.localeCompare(second.title, undefined, { sensitivity: 'base' });
  };
  const ranked = [
    ...editions.filter((edition) => edition.hasDigitalCopy).sort(compare),
    ...editions.filter((edition) => !edition.hasDigitalCopy).sort(compare),
  ];
  const selected = editions.find((edition) => edition.key === preferredId);
  const featured = selected
    ? [selected, ...ranked.filter((edition) => edition.key !== selected.key)].slice(0, 10)
    : ranked.slice(0, 10);
  const featuredKeys = new Set(featured.map((edition) => edition.key));
  return {
    editions: [...featured, ...editions.filter((edition) => !featuredKeys.has(edition.key)).sort(compare)],
    featuredCount: featured.length,
    totalCount: editions.length,
  };
}

test('large edition lists have exactly the same data and ranking with one publication-date calculation per edition', async () => {
  const originalFetch = globalThis.fetch;
  const originalParse = Date.parse;
  let parseCalls = 0;
  Date.parse = (value) => {
    parseCalls++;
    return originalParse(value);
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/works/OL1W/editions.json');
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ size: entries.length, entries: entries.slice(offset, offset + 1000) });
  };
  try {
    for (const [preferredId, language] of [['', ''], ['/books/OL25M', 'fre'], ['/books/OL2M', 'eng']]) {
      parseCalls = 0;
      const expected = legacyRanking(preferredId, language);
      const legacyCalls = parseCalls;
      parseCalls = 0;
      const params = new URLSearchParams({ work: 'works/OL1W', preferred_edition: preferredId, language });
      const response = await GET({
        url: new URL(`http://localhost/api/book-editions.json?${params}`),
      } as Parameters<typeof GET>[0]);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
      assert.equal(parseCalls, entries.length + entries.filter((entry) => Array.isArray(entry.publish_date)).length);
      assert.ok(legacyCalls > parseCalls * 3, 'date parsing must be substantially reduced');
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.parse = originalParse;
  }
});
