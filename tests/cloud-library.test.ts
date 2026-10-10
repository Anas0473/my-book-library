import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeCloudBooks, applyCloudChanges, cloudSnapshot, diffCloudBooks, validateCloudChanges, type CloudBook, type CloudBooks } from '../src/lib/cloud-library.ts';
import { createCloudLibraryClient } from '../src/lib/cloud-library-client.ts';
import { GET, PUT } from '../src/pages/api/cloud-library.json.ts';

const edition = (editionKey: string) => ({
  title: 'Elementer', status: 'Plan to Read', workKey: '/works/OL912133W', editionKey,
});

test('cloud storage keeps every edition of the same work', () => {
  const books = cloudSnapshot([edition('/books/OL1M'), edition('/books/OL2M')]);
  assert.equal(activeCloudBooks(books).length, 2);
});

test('a stale first import cannot resurrect a deleted book or overwrite remote edits', () => {
  const first = edition('/books/OL1M');
  const second = edition('/books/OL2M');
  const remote = { 'edition:OL1M': null, 'edition:OL2M': { ...second, status: 'Read' } };
  const changes = diffCloudBooks({}, cloudSnapshot([first, second]))
    .map((change) => ({ ...change, importOnly: true }));
  assert.deepEqual(applyCloudChanges(remote, changes), remote);
});

test('per-book changes preserve editions added by another device', () => {
  const first = edition('/books/OL1M');
  const second = edition('/books/OL2M');
  const before = cloudSnapshot([first]);
  const remote = cloudSnapshot([first, second]);
  const changes = diffCloudBooks(before, cloudSnapshot([{ ...first, status: 'Read' }]));
  const merged = activeCloudBooks(applyCloudChanges(remote, changes));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((book) => book.editionKey === first.editionKey)?.status, 'Read');
});

test('removing one edition does not remove other editions', () => {
  const first = edition('/books/OL1M');
  const second = edition('/books/OL2M');
  const before = cloudSnapshot([first, second]);
  const changes = diffCloudBooks(before, cloudSnapshot([second]));
  assert.deepEqual(activeCloudBooks(applyCloudChanges(before, changes)), [second]);
});

test('cloud change validation rejects spoofed identities, unsafe URLs and invalid shelves', () => {
  const book = edition('/books/OL1M');
  const change = { id: 'edition:OL1M', book };
  assert.equal(validateCloudChanges([change])[0].book?.title, 'Elementer');
  assert.throws(() => validateCloudChanges([{ ...change, id: 'edition:OL2M' }]));
  assert.throws(() => validateCloudChanges([{ ...change, book: { ...book, status: 'Other' } }]));
  assert.throws(() => validateCloudChanges([{ ...change, book: { ...book, editionUrl: 'javascript:alert(1)' } }]));
  assert.throws(() => validateCloudChanges([change, change]));
});

function memoryStorage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) || null,
    setItem: (key: string, value: string) => { entries.set(key, value); } };
}

test('cloud client imports local editions, downloads remote ones and rebases concurrent writes', async () => {
  let books = [edition('/books/OL1M')];
  let remote = cloudSnapshot([edition('/books/OL2M')]);
  let revision = 1;
  let conflicted = false;
  const client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books, setBooks: (next) => { books = next as typeof books; },
    message: () => {},
    request: async (_url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        if (!conflicted) {
          conflicted = true;
          remote = { ...remote, ...cloudSnapshot([edition('/books/OL3M')]) };
          revision++;
          return Response.json({ username: 'reader', revision, books: remote }, { status: 409 });
        }
        assert.equal(body.revision, revision);
        remote = applyCloudChanges(remote, body.changes);
        revision++;
      }
      return Response.json({ username: 'reader', revision, books: remote });
    },
  });
  assert.equal(await client.connect('reader'), true);
  assert.equal(books.length, 3);
  books = books.filter((book) => book.editionKey !== '/books/OL1M');
  client.capture();
  await client.sync();
  assert.equal(remote['edition:OL1M'], null);
  assert.equal(activeCloudBooks(remote).length, 2);
});

test('cloud client retains offline edits across a reload', async () => {
  const storage = memoryStorage();
  let books = [edition('/books/OL1M')];
  let online = false;
  let remote = {};
  const options = {
    storage, getBooks: () => books, setBooks: (next: any[]) => { books = next; }, message: () => {},
    request: async (_url: any, init?: RequestInit) => {
      if (!online) throw new TypeError('Offline');
      if (init?.method === 'PUT') remote = applyCloudChanges(remote, JSON.parse(String(init.body)).changes);
      return Response.json({ username: 'reader', revision: 1, books: remote });
    },
  };
  const client = createCloudLibraryClient(options);
  assert.equal(await client.connect('reader'), false);
  books.push(edition('/books/OL2M'));
  client.capture();
  const reloaded = createCloudLibraryClient(options);
  online = true;
  assert.equal(await reloaded.connect('reader'), true);
  assert.equal(activeCloudBooks(remote).length, 2);
});

test('account switching backs up the previous library without uploading it to the new account', async () => {
  const storage = memoryStorage();
  let books = [edition('/books/OL1M')];
  let owner = 'reader';
  let remote = {};
  const uploads: string[] = [];
  const client = createCloudLibraryClient({
    storage, getBooks: () => books, setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: async (_url, init) => {
      if (init?.method === 'PUT') {
        const changes = JSON.parse(String(init.body)).changes;
        changes.forEach((change: any) => uploads.push(`${owner}:${change.id}`));
        remote = applyCloudChanges(remote, changes);
      }
      return Response.json({ username: owner, revision: 1, books: remote });
    },
  });
  await client.connect('reader');
  owner = 'other-reader';
  remote = cloudSnapshot([edition('/books/OL2M')]);
  await client.connect(owner);
  assert.equal(uploads.includes('other-reader:edition:OL1M'), false);
  assert.equal(books[0].editionKey, '/books/OL2M');
  assert.equal(JSON.parse(storage.getItem('my-book-library:cloud-backup:reader') || '[]')[0].editionKey, '/books/OL1M');
});

test('a newer local edit made during an upload is not discarded when the older upload completes', async () => {
  let books = [edition('/books/OL1M')];
  let remote = {};
  let firstUpload = true;
  let client: ReturnType<typeof createCloudLibraryClient>;
  client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books, setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: async (_url, init) => {
      if (init?.method === 'PUT') {
        remote = applyCloudChanges(remote, JSON.parse(String(init.body)).changes);
        if (firstUpload) {
          firstUpload = false;
          books = [{ ...books[0], status: 'Read' }];
          client.capture();
        }
      }
      return Response.json({ username: 'reader', revision: 1, books: remote });
    },
  });
  await client.connect('reader');
  assert.equal(activeCloudBooks(remote)[0].status, 'Read');
  assert.equal(books[0].status, 'Read');
});

test('cloud API rejects cross-origin writes and unauthenticated reads without querying the database', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.STORAGE_URL;
  let requests = 0;
  process.env.STORAGE_URL = 'postgresql://test:test@example.neon.tech/test';
  globalThis.fetch = async () => { requests++; throw new Error('Database must not be called'); };
  try {
    const cookies = { get: () => undefined };
    const url = new URL('https://library.example/api/cloud-library.json');
    const read = await GET({ cookies, url } as unknown as Parameters<typeof GET>[0]);
    assert.equal(read.status, 401);
    const write = await PUT({ cookies, url,
      request: new Request(url, { method: 'PUT', headers: { Origin: 'https://other.example' } }),
    } as unknown as Parameters<typeof PUT>[0]);
    assert.equal(write.status, 403);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = originalUrl;
  }
});

test('website accounts sync Open Library metadata and fallback books without treating it as account ownership', async () => {
  let books = [
    { ...edition('/books/OL1M'), openLibrarySyncUsername: 'openlibrary-reader' },
    { title: 'Fallback book', status: 'Read', key: 'archive:example' },
  ];
  let remote = {};
  const client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books,
    setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: async (_url, init) => {
      if (init?.method === 'PUT') remote = applyCloudChanges(remote, JSON.parse(String(init.body)).changes);
      return Response.json({ username: 'clerk:user_reader', revision: 1, books: remote });
    },
  });
  await client.connect('clerk:user_reader');
  assert.equal(activeCloudBooks(remote).length, 2);
});

test('signing out hides account books and signing back in merges guest additions without deleting the account library', async () => {
  const storage = memoryStorage();
  let books = [edition('/books/OL1M')];
  let remote = {};
  const client = createCloudLibraryClient({
    storage, getBooks: () => books, setBooks: (next) => { books = next as typeof books; },
    message: () => {},
    request: async (_url, init) => {
      if (init?.method === 'PUT') remote = applyCloudChanges(remote, JSON.parse(String(init.body)).changes);
      return Response.json({ username: 'clerk:user_reader', revision: 1, books: remote });
    },
  });
  await client.connect('clerk:user_reader');
  client.enterGuest();
  assert.equal(books.length, 0);
  assert.equal(storage.getItem('my-book-library:cloud-owner'), null);
  books.push(edition('/books/OL2M'));
  await client.connect('clerk:user_reader');
  assert.equal(books.length, 2);
  assert.equal(activeCloudBooks(remote).length, 2);
  assert.notEqual(remote['edition:OL1M' as keyof typeof remote], null);
});

test('signing out keeps unsent edits for the same account without transferring them to another account', async () => {
  const storage = memoryStorage();
  let books = [edition('/books/OL1M')];
  let owner = 'clerk:user_first';
  let online = false;
  let remote = {};
  const client = createCloudLibraryClient({
    storage, getBooks: () => books, setBooks: (next) => { books = next as typeof books; },
    message: () => {},
    request: async (_url, init) => {
      if (!online) throw new TypeError('Offline');
      if (init?.method === 'PUT') remote = applyCloudChanges(remote, JSON.parse(String(init.body)).changes);
      return Response.json({ username: owner, revision: 1, books: remote });
    },
  });
  await client.connect(owner);
  books.push(edition('/books/OL2M'));
  client.enterGuest();
  online = true;
  owner = 'clerk:user_second';
  await client.connect(owner);
  assert.deepEqual(remote, {});
  client.enterGuest();
  owner = 'clerk:user_first';
  await client.connect(owner);
  assert.equal(activeCloudBooks(remote).length, 2);
});

test('accounts without configured cloud storage still keep separate local caches', async () => {
  let books = [edition('/books/OL1M')];
  const client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books,
    setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: async () => { throw new Error('Must not contact cloud storage'); },
  });
  await client.connect('clerk:user_first', { sync: false });
  await client.connect('clerk:user_second', { sync: false });
  assert.equal(books.length, 0);
  await client.connect('clerk:user_first', { sync: false });
  assert.equal(books[0].editionKey, '/books/OL1M');
});

test('signing out during a cloud read cannot restore private books into the guest library', async () => {
  let books = [edition('/books/OL1M')];
  let resolveRead!: (response: Response) => void;
  const client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books,
    setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: () => new Promise((resolve) => { resolveRead = resolve; }),
  });
  const connecting = client.connect('clerk:user_reader');
  client.enterGuest();
  resolveRead(Response.json({ username: 'clerk:user_reader', revision: 0,
    books: cloudSnapshot([edition('/books/OL2M')]) }));
  assert.equal(await connecting, false);
  assert.deepEqual(books, []);
});

test('a queued reconnect cannot re-enable an account after sign-out', async () => {
  let books = [edition('/books/OL1M')];
  let resolveRead!: (response: Response) => void;
  const client = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => books,
    setBooks: (next) => { books = next as typeof books; }, message: () => {},
    request: () => new Promise((resolve) => { resolveRead = resolve; }),
  });
  const firstConnect = client.connect('clerk:user_reader');
  const reconnect = client.connect('clerk:user_reader');
  client.enterGuest();
  resolveRead(Response.json({ username: 'clerk:user_reader', revision: 0, books: {} }));
  assert.equal(await firstConnect, false);
  assert.equal(await reconnect, false);
  assert.equal(books.length, 0);
});

test('PC and mobile share additions, shelf changes and deletions without an Open Library account', async () => {
  let remote: CloudBooks = {};
  let revision = 0;
  const request: typeof fetch = async (_url, init) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      if (body.revision !== revision) {
        return Response.json({ username: 'clerk:user_reader', revision, books: remote }, { status: 409 });
      }
      remote = applyCloudChanges(remote, body.changes);
      revision++;
    }
    return Response.json({ username: 'clerk:user_reader', revision, books: remote });
  };
  let pcBooks: CloudBook[] = [{ title: 'Archive book', key: 'archive:example', status: 'Plan to Read' }];
  let mobileBooks: CloudBook[] = [];
  const pc = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => pcBooks, setBooks: (books) => { pcBooks = books; },
    message: () => {}, request,
  });
  const mobile = createCloudLibraryClient({
    storage: memoryStorage(), getBooks: () => mobileBooks, setBooks: (books) => { mobileBooks = books; },
    message: () => {}, request,
  });
  await pc.connect('clerk:user_reader');
  await mobile.connect('clerk:user_reader');
  assert.equal(mobileBooks.length, 1);
  mobileBooks[0] = { ...mobileBooks[0], status: 'Read' };
  await mobile.sync();
  await pc.sync();
  assert.equal(pcBooks[0].status, 'Read');
  pcBooks = [];
  await pc.sync();
  await mobile.sync();
  assert.equal(mobileBooks.length, 0);
  assert.equal(remote['book:archive:example'], null);
});