interface RecommendationIdentity {
  key?: string | null;
  workKey?: string | null;
  title?: string | null;
  subtitle?: string | null;
  author?: string | null;
}

export function isSameRecommendedBook(first: RecommendationIdentity, second: RecommendationIdentity) {
  const getWorkId = (book: RecommendationIdentity) =>
    String(book.workKey || book.key || '').match(/(?:^|\/)works\/(OL\d+W)$/i)?.[1]?.toUpperCase() || '';
  const firstWorkId = getWorkId(first);
  if (firstWorkId && firstWorkId === getWorkId(second)) return true;

  const normalize = (value: string | null | undefined) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const firstTitle = normalize(first.title);
  const secondTitle = normalize(second.title);
  if (!firstTitle || firstTitle !== secondTitle) return false;

  const getAuthors = (value: string | null | undefined) => String(value || '')
    .split(/,|&|\band\b/i)
    .map(normalize)
    .filter(Boolean);
  const firstAuthors = getAuthors(first.author);
  const secondAuthors = getAuthors(second.author);
  return firstAuthors.some((author) => secondAuthors.includes(author));
}

export function deduplicateRecommendedBooks<T extends RecommendationIdentity>(books: T[]) {
  const uniqueBooks: T[] = [];
  for (const book of books) {
    if (!uniqueBooks.some((existing) => isSameRecommendedBook(existing, book))) {
      uniqueBooks.push(book);
    }
  }
  return uniqueBooks;
}