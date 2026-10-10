export interface CloudBook {
  [field: string]: unknown;
  title: string;
  status: string;
  editionKey?: string;
  key?: string;
  workKey?: string;
  isbn?: string;
  author?: string;
  rating?: number;
}

export type CloudBooks = Record<string, CloudBook | null>;
export interface CloudChange {
  id: string;
  book: CloudBook | null;
  importOnly?: boolean;
}

export function cloudBookId(book: CloudBook) {
  const edition = String(book.editionKey || '').match(/OL\d+M/i)?.[0].toUpperCase();
  if (edition) return `edition:${edition}`;
  const isbn = String(book.isbn || '').replace(/[\s-]/g, '').toUpperCase();
  if (isbn) return `isbn:${isbn}`;
  return `book:${book.key || book.workKey || `${book.title}:${book.author || ''}`}`;
}

export function cloudSnapshot(books: CloudBook[]): CloudBooks {
  return Object.fromEntries(books.map((book) => [cloudBookId(book), book]));
}

// The cloud database reorders a book's fields, so compare them in a fixed order.
function sameBook(first: CloudBook | null | undefined, second: CloudBook | null | undefined) {
  const sorted = (book: CloudBook | null | undefined) => book
    ? JSON.stringify(Object.keys(book).filter((field) => book[field] !== undefined).sort()
      .map((field) => [field, book[field]]))
    : String(book);
  return sorted(first) === sorted(second);
}

export function diffCloudBooks(before: CloudBooks, after: CloudBooks): CloudChange[] {
  const changes: CloudChange[] = [];
  for (const [id, book] of Object.entries(after)) {
    if (!sameBook(book, before[id])) changes.push({ id, book });
  }
  for (const [id, book] of Object.entries(before)) {
    if (book && !(id in after)) changes.push({ id, book: null });
  }
  return changes;
}

export function applyCloudChanges(books: CloudBooks, changes: CloudChange[]): CloudBooks {
  const next = { ...books };
  for (const change of changes) {
    if (!change.importOnly || !Object.hasOwn(next, change.id)) next[change.id] = change.book;
  }
  return next;
}

export function activeCloudBooks(books: CloudBooks) {
  return Object.values(books).filter((book): book is CloudBook => book !== null);
}

export function validateCloudChanges(value: unknown): CloudChange[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid cloud changes.');
  const stringFields = [
    'key', 'workKey', 'editionKey', 'loggedEditionKey', 'editionUrl', 'editionHeroImage',
    'editionLanguage', 'title', 'subtitle', 'author', 'publisher', 'pubDate', 'isbn',
    'heroImage', 'status', 'openLibrarySyncUsername',
  ];
  const urlFields = new Set(['editionUrl', 'editionHeroImage', 'heroImage']);
  const changes = value.map((change): CloudChange => {
    if (!change || typeof change.id !== 'string' || change.id.length > 1000
      || !/^(edition|isbn|book):/.test(change.id)
      || (change.importOnly !== undefined && typeof change.importOnly !== 'boolean')) {
      throw new Error('Invalid cloud book identity.');
    }
    if (change.book === null) return { id: change.id, book: null, importOnly: change.importOnly };
    if (!change.book || typeof change.book !== 'object' || Array.isArray(change.book)) {
      throw new Error('Invalid cloud book.');
    }
    const book: Record<string, unknown> = {};
    for (const field of stringFields) {
      const fieldValue = change.book[field];
      if (fieldValue === undefined || fieldValue === null) continue;
      if (typeof fieldValue !== 'string' || fieldValue.length > 4000) throw new Error('Invalid book field.');
      if (urlFields.has(field) && fieldValue && !/^https?:\/\//i.test(fieldValue)) {
        throw new Error('Invalid book URL.');
      }
      book[field] = fieldValue;
    }
    for (const field of ['dateAdded', 'editionCount']) {
      if (change.book[field] === undefined || change.book[field] === null) continue;
      if (typeof change.book[field] !== 'number' || !Number.isFinite(change.book[field])
        || change.book[field] < 0) throw new Error('Invalid book number.');
      book[field] = change.book[field];
    }
    for (const field of ['openLibraryLocalOnly', 'openLibraryRemoved']) {
      if (change.book[field] === undefined) continue;
      if (typeof change.book[field] !== 'boolean') throw new Error('Invalid book flag.');
      book[field] = change.book[field];
    }
    if (change.book.rating !== undefined && change.book.rating !== null) {
      if (typeof change.book.rating !== 'number' || !Number.isInteger(change.book.rating)
        || change.book.rating < 1 || change.book.rating > 5) throw new Error('Invalid book rating.');
      book.rating = change.book.rating;
    }
    if (typeof book.title !== 'string' || !book.title.trim()
      || !['Plan to Read', 'Reading', 'Read'].includes(String(book.status))) {
      throw new Error('Invalid book title or shelf.');
    }
    const cloudBook = book as CloudBook;
    if (cloudBookId(cloudBook) !== change.id) throw new Error('Book identity does not match.');
    return { id: change.id, book: cloudBook, importOnly: change.importOnly };
  });
  if (new Set(changes.map((change) => change.id)).size !== changes.length) {
    throw new Error('Duplicate cloud changes.');
  }
  return changes;
}