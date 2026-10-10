import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeOpenLibraryImport } from '../src/lib/openlibrary-import.ts';
import { isLocalOnlyEdition, shelfSnapshot } from '../src/lib/openlibrary-push.ts';

const book = { key: '/works/OL1W', title: 'A book', status: 'Read', editionKey: '/books/OL1M' };

test('import adds copies without Open Library connection metadata or queued shelf changes', () => {
  const imported = mergeOpenLibraryImport([], [{ ...book,
    openLibrarySyncUsername: 'reader', loggedEditionKey: '/books/OL1M', openLibraryRemoved: true }]);
  assert.equal(imported.added, 1);
  assert.equal(imported.books[0].openLibrarySyncUsername, undefined);
  assert.equal(imported.books[0].loggedEditionKey, undefined);
  assert.equal(imported.books[0].openLibraryRemoved, undefined);
  assert.equal(imported.books[0].openLibraryLocalOnly, true);
  assert.equal(shelfSnapshot(imported.books).size, 0);
  assert.equal(isLocalOnlyEdition(imported.books[0], imported.books), false,
    'an imported book is not an extra edition');
});

test('previously imported local-only books are not extra editions, but genuine extra copies are', () => {
  const imported = { ...book, openLibraryLocalOnly: true };
  assert.equal(isLocalOnlyEdition(imported, [imported]), false);
  const otherEdition = { ...book, editionKey: '/books/OL2M' };
  assert.equal(isLocalOnlyEdition(imported, [imported, otherEdition]), true);
});

test('repeat imports and duplicates preserve existing books and statuses', () => {
  const existing = [{ ...book, status: 'Reading' }];
  const imported = mergeOpenLibraryImport(existing, [book, book]);
  assert.equal(imported.added, 0);
  assert.deepEqual(imported.books, existing);
  const first = mergeOpenLibraryImport([], [book, book]);
  assert.equal(first.added, 1);
  assert.equal(mergeOpenLibraryImport(first.books, [book]).added, 0);
});

test('invalid responses fail without mutating any existing books', () => {
  const existing = [book];
  assert.throws(() => mergeOpenLibraryImport(existing, null));
  assert.throws(() => mergeOpenLibraryImport(existing, [
    { ...book, key: '/works/OL2W', editionKey: '/books/OL2M' }, { title: 'Broken', status: 'invalid' },
  ]));
  assert.deepEqual(existing, [book]);
});
