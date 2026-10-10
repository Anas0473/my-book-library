import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const start = page.indexOf('      type OpenLibrarySyncOptions =');
const end = page.indexOf('      function countBrowserOnlyBooks()', start);
assert.ok(start >= 0 && end > start);
const script = ts.transpile(page.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function setup(books, responseBooks = books, incompleteShelves = []) {
  const storage = new Map();
  let finishRequest;
  const context = vm.createContext({
    localBooks: structuredClone(books),
    openLibrarySyncMessage: { textContent: '' },
    openLibrarySyncSubmit: { disabled: false },
    openLibrarySyncDialog: { open: true, close() { throw new Error('Unexpected dialog close'); } },
    window: {
      confirm: () => true,
      location: { reload() { throw new Error('Unexpected reload'); } },
      setTimeout() { throw new Error('Unexpected delayed navigation'); },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    openLibraryUsernameKey: 'username',
    openLibraryLastSyncKey: 'lastSync',
    openLibraryLastSyncResultKey: 'lastResult',
    getOpenLibraryPushUser: () => 'reader',
    cloudLibrary: { sync: async () => true },
    flushOpenLibraryChanges: async () => {},
    readPendingOpenLibraryChanges: () => [],
    fetch: () => new Promise((resolve) => { finishRequest = resolve; }),
    createSyncBookIndex: (items, matches) => ({
      findIndex: (book) => items.findIndex((item) => matches(item, book)),
      find: (book) => items.find((item) => matches(item, book)),
      set: (index, book) => { items[index] = book; },
    }),
    workIdOf: (book) => book.workKey || book.key,
    isSameBook: (a, b) => a.key === b.key,
    saveLocalBooksWithoutPush: () => {},
    viewRefreshes: 0,
    refreshLibraryView: () => { context.viewRefreshes++; },
    updateOpenLibrarySyncLabel: () => {},
    showOpenLibraryStatus: (message) => { context.status = message; },
  });
  vm.runInContext(script, context);
  return {
    context,
    async sync(options = {}) {
      const promise = context.syncOpenLibrary('reader', options);
      // Let the cloud sync and pending-write checks finish before resolving the pull.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(context.openLibrarySyncMessage.textContent,
        'Checking for updates from Open Library.\nYour saved books are ready to use.');
      finishRequest({
        ok: true,
        json: async () => ({ books: structuredClone(responseBooks), incompleteShelves }),
      });
      await promise;
    },
  };
}

const book = {
  key: '/works/OL1W', title: 'Original', status: 'Read', dateAdded: 1,
  isbn: null, publisher: null, openLibrarySyncUsername: 'reader', openLibraryRemoved: false,
};

test('changed sync updates the list in place and leaves the dialog open', async () => {
  const { context, sync } = setup([book], [{ ...book, title: 'Updated' }]);
  await sync();
  assert.equal(context.localBooks[0].title, 'Updated');
  assert.equal(context.viewRefreshes, 1);
  assert.equal(context.openLibrarySyncDialog.open, true);
  assert.equal(context.openLibrarySyncMessage.textContent, 'Up to date.');
  assert.equal(context.openLibrarySyncSubmit.disabled, false);
  assert.equal(context.status, '');
});

test('unchanged sync finishes without redrawing or closing the dialog', async () => {
  const { context, sync } = setup([book]);
  await sync();
  assert.equal(context.viewRefreshes, 0);
  assert.equal(context.openLibrarySyncDialog.open, true);
  assert.equal(context.openLibrarySyncMessage.textContent, 'Up to date.');
});

test('background sync does not reopen a dialog the user has closed', async () => {
  const { context, sync } = setup([book], [{ ...book, title: 'Updated' }]);
  context.openLibrarySyncDialog.open = false;
  await sync({ quiet: true });
  assert.equal(context.openLibrarySyncDialog.open, false);
  assert.equal(context.viewRefreshes, 1);
});

test('malformed sync keeps saved books and shows an error instead of success', async () => {
  const { context, sync } = setup([book], null);
  await sync();
  assert.equal(context.localBooks[0].title, 'Original');
  assert.equal(context.viewRefreshes, 0);
  assert.match(context.openLibrarySyncMessage.textContent, /incomplete sync response/);
  assert.equal(context.openLibrarySyncSubmit.disabled, false);
});

test('incomplete shelves keep existing books and show a warning', async () => {
  const { context, sync } = setup([book], [], [{ status: 'Read' }]);
  await sync();
  assert.equal(context.localBooks.length, 1);
  assert.match(context.openLibrarySyncMessage.textContent, /older synced books were kept/);
});
