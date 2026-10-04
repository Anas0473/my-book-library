import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffShelves, isLocalOnlyEdition, mergePendingChanges, shelfSnapshot } from '../src/lib/openlibrary-push';
import { usernameFromSession } from '../src/lib/openlibrary-session';

const book = (overrides: Record<string, unknown> = {}) => ({
  title: 'Dune',
  workKey: '/works/OL893415W',
  editionKey: '/books/OL1M',
  status: 'Plan to Read',
  dateAdded: 1,
  ...overrides,
});

test('adding, moving and removing books become Open Library shelf changes', () => {
  const empty = shelfSnapshot([]);
  const added = shelfSnapshot([book()]);
  assert.deepEqual(diffShelves(empty, added), [
    { workId: 'OL893415W', status: 'Plan to Read', editionKey: '/books/OL1M' },
  ]);

  const moved = shelfSnapshot([book({ status: 'Read' })]);
  assert.deepEqual(diffShelves(added, moved), [
    { workId: 'OL893415W', status: 'Read', editionKey: '/books/OL1M' },
  ]);

  assert.deepEqual(diffShelves(moved, empty), [
    { workId: 'OL893415W', status: null, editionKey: null },
  ]);
});

test('unchanged books, books without a work and language-only edits send nothing', () => {
  const before = shelfSnapshot([book(), { title: 'Local only', status: 'Reading' }]);
  const after = shelfSnapshot([book({ editionLanguage: 'eng' }), { title: 'Local only', status: 'Read' }]);
  assert.deepEqual(diffShelves(before, after), []);
});

test('choosing another edition updates the logged edition', () => {
  const before = shelfSnapshot([book()]);
  const after = shelfSnapshot([book({ editionKey: '/books/OL2M' })]);
  assert.deepEqual(diffShelves(before, after), [
    { workId: 'OL893415W', status: 'Plan to Read', editionKey: '/books/OL2M' },
  ]);
});

test('books removed on Open Library are not pushed back until they are moved', () => {
  const before = shelfSnapshot([book({ openLibraryRemoved: true })]);
  assert.deepEqual(diffShelves(before, shelfSnapshot([])), []);
  assert.deepEqual(
    diffShelves(before, shelfSnapshot([book({ openLibraryRemoved: true, editionKey: '/books/OL2M' })])),
    [],
  );
  assert.deepEqual(diffShelves(before, shelfSnapshot([book({ status: 'Read' })])), [
    { workId: 'OL893415W', status: 'Read', editionKey: '/books/OL1M' },
  ]);
});

test('extra editions of a book already in the lists stay only on this site', () => {
  const original = book({ status: 'Read', openLibrarySyncUsername: 'anas' });
  const extra = book({ editionKey: '/books/OL2M', dateAdded: 2 });
  assert.equal(isLocalOnlyEdition(extra, [original]), true);
  assert.equal(isLocalOnlyEdition(book({ workKey: '/works/OL9W' }), [original]), false);
  assert.equal(isLocalOnlyEdition(extra, [{ ...original, openLibraryLocalOnly: true }]), false);

  const before = shelfSnapshot([original]);
  const withExtra = shelfSnapshot([original, { ...extra, openLibraryLocalOnly: true }]);
  assert.deepEqual(diffShelves(before, withExtra), []);
  assert.deepEqual(diffShelves(withExtra, before), []);
  assert.deepEqual(diffShelves(withExtra, shelfSnapshot([{ ...extra, openLibraryLocalOnly: true }])), [
    { workId: 'OL893415W', status: null, editionKey: null },
  ]);
});

test('a copy still on Open Library wins over one removed there', () => {
  const snapshot = shelfSnapshot([
    book({ status: 'Read' }),
    book({ editionKey: '/books/OL2M', dateAdded: 2, openLibraryRemoved: true }),
  ]);
  assert.equal(snapshot.get('OL893415W')?.status, 'Read');
});

test('pending changes keep only the latest change per work', () => {
  const merged = mergePendingChanges(
    [
      { workId: 'OL1W', status: 'Reading', editionKey: null },
      { workId: 'OL2W', status: 'Read', editionKey: null },
    ],
    [{ workId: 'OL1W', status: null, editionKey: null }],
  );
  assert.deepEqual(merged, [
    { workId: 'OL2W', status: 'Read', editionKey: null },
    { workId: 'OL1W', status: null, editionKey: null },
  ]);
});

test('the username is read from the Open Library session cookie', () => {
  assert.equal(usernameFromSession('/people/anas,2026-10-04T10:00:00,abc$123'), 'anas');
  assert.equal(usernameFromSession('%2Fpeople%2Fanas%2C2026-10-04T10%3A00%3A00%2Cabc%24123'), 'anas');
  assert.equal(usernameFromSession('garbage'), null);
  assert.equal(usernameFromSession(undefined), null);
});
