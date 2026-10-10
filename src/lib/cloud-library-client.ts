import {
  activeCloudBooks, applyCloudChanges, cloudSnapshot, diffCloudBooks,
  type CloudBook, type CloudBooks, type CloudChange,
} from './cloud-library.ts';

interface SavedState {
  observed: CloudBooks;
  pending: CloudChange[];
  cache: CloudBook[];
}

interface ClientOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  getBooks: () => CloudBook[];
  setBooks: (books: CloudBook[]) => void;
  message: (message: string) => void;
  accountChanged?: () => void;
  request?: typeof fetch;
}

export function createCloudLibraryClient(options: ClientOptions) {
  const request = options.request || fetch;
  const ownerKey = 'my-book-library:cloud-owner';
  const stateKey = (owner: string) => `my-book-library:cloud-state:${owner}`;
  let username = options.storage.getItem(ownerKey) || '';
  let enabled = false;
  let generation = 0;
  let running: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: SavedState | null = loadState(username);

  function loadState(owner: string): SavedState | null {
    if (!owner) return null;
    try {
      const stored = JSON.parse(options.storage.getItem(stateKey(owner)) || 'null');
      return stored && stored.observed && Array.isArray(stored.pending) && Array.isArray(stored.cache)
        ? stored : null;
    } catch {
      return null;
    }
  }

  function saveState() {
    if (state && username) options.storage.setItem(stateKey(username), JSON.stringify(state));
  }

  function capture() {
    if (!state) return;
    const ownedBooks = options.getBooks().filter((book) =>
      username.startsWith('clerk:') || !book.openLibrarySyncUsername || book.openLibrarySyncUsername === username,
    );
    const current = cloudSnapshot(ownedBooks);
    const changes = diffCloudBooks(state.observed, current);
    if (changes.length) {
      const pending = new Map(state.pending.map((change) => [change.id, change]));
      changes.forEach((change) => pending.set(change.id, change));
      state.pending = [...pending.values()];
      state.observed = current;
      state.cache = ownedBooks;
      saveState();
    }
  }

  function schedule() {
    capture();
    if (!enabled) return;
    options.message('Changes waiting to sync.');
    clearTimeout(timer);
    timer = setTimeout(() => { void sync(); }, 500);
  }

  function accept(books: CloudBooks) {
    if (!state) return;
    const merged = activeCloudBooks(applyCloudChanges(books, state.pending));
    const changed = JSON.stringify(merged) !== JSON.stringify(options.getBooks());
    state.observed = cloudSnapshot(merged);
    state.cache = merged;
    saveState();
    if (changed) options.setBooks(merged);
  }

  async function readResponse(response: Response, owner: string) {
    const data = await response.json();
    if ((!response.ok && response.status !== 409) || data.username !== owner
      || !Number.isSafeInteger(data.revision) || data.revision < 0
      || !data.books || typeof data.books !== 'object' || Array.isArray(data.books)
      || Object.values(data.books).some((book) => book !== null
        && (typeof book !== 'object' || !book || !('title' in book) || typeof book.title !== 'string'
          || !('status' in book) || !['Plan to Read', 'Reading', 'Read'].includes(String(book.status))))) {
      throw new Error(data.error || 'Cloud library returned an invalid response. Your browser books were kept.');
    }
    return data as { username: string; revision: number; books: CloudBooks };
  }

  async function synchronize() {
    const owner = username;
    const sessionGeneration = generation;
    try {
      options.message('Syncing cloud library...');
      let remote = await readResponse(await request('/api/cloud-library.json', {
        cache: 'no-store', signal: AbortSignal.timeout(20000),
      }), owner);
      if (sessionGeneration !== generation || !enabled || !state) return false;
      capture();
      let attempts = 0;
      while (state.pending.length && attempts++ < 10) {
        const batch: CloudChange[] = [];
        let size = 0;
        for (const change of state.pending.slice(0, 500)) {
          size += new TextEncoder().encode(JSON.stringify(change)).length;
          if (size > 800000) break;
          batch.push(change);
        }
        if (!batch.length) throw new Error('A book is too large to sync. Your browser copy was kept.');
        const response = await request('/api/cloud-library.json', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: remote.revision, changes: batch }),
          signal: AbortSignal.timeout(20000),
        });
        remote = await readResponse(response, owner);
        if (sessionGeneration !== generation || !enabled || !state) return false;
        capture();
        if (response.ok) {
          const sent = new Map(batch.map((change) => [change.id, JSON.stringify(change)]));
          state.pending = state.pending.filter((change) => sent.get(change.id) !== JSON.stringify(change));
          saveState();
        }
      }
      if (state.pending.length) throw new Error('Cloud library is busy. Your changes are queued for the next sync.');
      accept(remote.books);
      options.message('Cloud library up to date.');
      return true;
    } catch (error) {
      if (sessionGeneration === generation) {
        options.message(error instanceof Error && error.name !== 'TimeoutError'
          ? `${error.message} Changes waiting to sync are kept on this device.`
          : 'Cloud library is unavailable. Your browser books and queued changes were kept.');
      }
      return false;
    }
  }

  function sync(): Promise<boolean> {
    capture();
    if (!enabled || !username || !state) return Promise.resolve(true);
    if (!running) running = synchronize().finally(() => { running = null; });
    return running;
  }

  async function connect(owner: string, { sync: shouldSync = true } = {}) {
    const sessionGeneration = generation;
    if (running) await running;
    if (sessionGeneration !== generation) return false;
    if (username !== owner) options.accountChanged?.();
    if (username && username !== owner) {
      capture();
      const previous = options.getBooks();
      options.storage.setItem(`my-book-library:cloud-backup:${username}`, JSON.stringify(previous));
      state = loadState(owner);
      options.setBooks(state?.cache || []);
    } else {
      state = loadState(owner);
      if (!username && state) {
        const guestBooks = options.getBooks();
        const cached = cloudSnapshot(state.cache);
        const imports = diffCloudBooks({}, cloudSnapshot(guestBooks))
          .filter((change) => !Object.hasOwn(cached, change.id))
          .map((change) => ({ ...change, importOnly: true }));
        const pending = new Map(state.pending.map((change) => [change.id, change]));
        for (const change of imports) {
          if (!pending.has(change.id)) pending.set(change.id, change);
        }
        state.pending = [...pending.values()];
        const restored = activeCloudBooks(applyCloudChanges(cached, imports));
        state.observed = cloudSnapshot(restored);
        state.cache = restored;
        options.setBooks(restored);
      }
    }
    username = owner;
    generation++;
    options.storage.setItem(ownerKey, owner);
    if (!state) {
      options.storage.setItem(`my-book-library:cloud-initial-backup:${owner}`, JSON.stringify(options.getBooks()));
      const books = options.getBooks().filter((book) =>
        owner.startsWith('clerk:') || !book.openLibrarySyncUsername || book.openLibrarySyncUsername === owner,
      );
      const observed = cloudSnapshot(books);
      state = { observed, cache: books, pending: diffCloudBooks({}, observed)
        .map((change) => ({ ...change, importOnly: true })) };
    }
    saveState();
    enabled = shouldSync;
    if (!shouldSync) return false;
    return sync();
  }

  function disconnect() {
    capture();
    enabled = false;
    generation++;
    clearTimeout(timer);
  }

  function enterGuest() {
    disconnect();
    if (username) {
      options.accountChanged?.();
      username = '';
      options.storage.setItem(ownerKey, '');
      state = null;
      options.setBooks([]);
    }
    options.message('Saved on this device. Sign in to sync between devices.');
  }

  return { capture, schedule, connect, disconnect, sync, enterGuest };
}