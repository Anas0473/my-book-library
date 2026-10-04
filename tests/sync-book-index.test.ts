import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyncBookIndex } from '../src/lib/sync-book-index';

interface Book {
  key?: string;
  workKey?: string;
  editionKey?: string;
  loggedEditionKey?: string;
  openLibrarySyncUsername?: string;
  title?: string;
  isbn?: string;
}

function matches(existing: Book, incoming: Book) {
  const existingEdition = existing.loggedEditionKey || existing.editionKey;
  const incomingEdition = incoming.loggedEditionKey || incoming.editionKey;
  if (existingEdition && incomingEdition) return existingEdition === incomingEdition;
  if (existing.openLibrarySyncUsername || incoming.openLibrarySyncUsername) {
    const existingWork = existing.workKey || existing.key;
    const incomingWork = incoming.workKey || incoming.key;
    if (existingWork && incomingWork) return existingWork === incomingWork;
  }
  if (existing.editionKey || incoming.editionKey) {
    return Boolean(existing.editionKey && existing.editionKey === incoming.editionKey);
  }
  return Boolean(
    (existing.isbn && existing.isbn === incoming.isbn)
    || (existing.title && existing.title === incoming.title),
  );
}

test('indexed sync matching agrees with a linear scan, including duplicates and missing identities', () => {
  const books: Book[] = Array.from({ length: 300 }, (_, index) => ({
    key: index % 4 ? `/works/OL${index % 23}W` : undefined,
    workKey: index % 3 ? `/works/OL${index % 19}W` : undefined,
    editionKey: index % 5 ? `/books/OL${index % 41}M` : undefined,
    loggedEditionKey: index % 7 ? undefined : `/books/OL${index % 31}M`,
    openLibrarySyncUsername: index % 2 ? 'reader' : undefined,
    title: `Book ${index % 13}`,
    isbn: index % 6 ? undefined : `isbn-${index % 11}`,
  }));
  const indexed = createSyncBookIndex(books, matches);
  const queries: Book[] = [
    ...books.map((book) => ({ ...book, openLibrarySyncUsername: 'reader' })),
    ...Array.from({ length: 100 }, (_, index) => ({
      key: index % 3 ? `/works/OL${index % 29}W` : undefined,
      editionKey: index % 2 ? `/books/OL${index % 47}M` : undefined,
      loggedEditionKey: index % 4 ? undefined : `/books/OL${index % 17}M`,
      openLibrarySyncUsername: 'reader',
      title: `Book ${index % 13}`,
      isbn: `isbn-${index % 11}`,
    })),
    { openLibrarySyncUsername: 'reader' },
  ];
  const check = () => {
    queries.forEach((query) => {
      const expected = books.findIndex((book) => matches(book, query));
      assert.equal(indexed.findIndex(query), expected, JSON.stringify(query));
      assert.equal(indexed.find(query), expected < 0 ? undefined : books[expected]);
    });
  };
  check();
  for (const index of [0, 1, 17, 140, 299]) {
    const replacement = { ...books[index], editionKey: '/books/OL999M', loggedEditionKey: undefined };
    books[index] = replacement;
    indexed.set(index, replacement);
  }
  const added = { workKey: '/works/OL999W', editionKey: '/books/OL999M' };
  indexed.set(books.length, added);
  books.push(added);
  queries.push({ ...added, openLibrarySyncUsername: 'reader' });
  check();
});

test('changing an indexed book removes stale candidates and preserves the earliest duplicate', () => {
  const books = [
    { editionKey: '/books/OL1M' },
    { editionKey: '/books/OL1M' },
    { editionKey: '/books/OL2M' },
  ];
  const indexed = createSyncBookIndex(books, matches);
  indexed.set(0, { editionKey: '/books/OL2M' });
  assert.equal(indexed.findIndex({ editionKey: '/books/OL1M' }), 1);
  assert.equal(indexed.findIndex({ editionKey: '/books/OL2M' }), 0);
  indexed.set(0, { editionKey: '/books/OL1M' });
  assert.equal(indexed.findIndex({ editionKey: '/books/OL1M' }), 0);
});

test('unique-edition matching checks one candidate per book rather than scanning the full library', () => {
  const books = Array.from({ length: 5000 }, (_, index) => ({
    workKey: `/works/OL${index}W`,
    editionKey: `/books/OL${index}M`,
    openLibrarySyncUsername: 'reader',
  }));
  let comparisons = 0;
  const indexed = createSyncBookIndex(books, (existing, incoming) => {
    comparisons++;
    return matches(existing, incoming);
  });
  books.forEach((book, index) => assert.equal(indexed.findIndex(book), index));
  assert.equal(comparisons, books.length);
});
