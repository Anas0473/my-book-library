import { cloudBookId, validateCloudChanges, type CloudBook } from './cloud-library.ts';

export function mergeOpenLibraryImport(existing: CloudBook[], incoming: unknown) {
  if (!Array.isArray(incoming)) throw new Error('Open Library returned an invalid list. Your saved books were kept.');
  const books = [...existing];
  const identities = new Set(existing.map(cloudBookId));
  let added = 0;
  for (const value of incoming) {
    if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.status !== 'string') {
      throw new Error('Open Library returned an invalid book. Your saved books were kept.');
    }
    const candidate: CloudBook = { ...value, title: value.title, status: value.status };
    const id = cloudBookId(candidate);
    const book = validateCloudChanges([{ id, book: candidate }])[0].book;
    if (!book) throw new Error('Open Library returned an empty book. Your saved books were kept.');
    if (identities.has(id)) continue;
    delete book.openLibrarySyncUsername;
    delete book.openLibraryRemoved;
    delete book.loggedEditionKey;
    book.openLibraryLocalOnly = true;
    books.push(book);
    identities.add(id);
    added++;
  }
  return { books, added };
}
