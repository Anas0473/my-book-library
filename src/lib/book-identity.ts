interface WorkIdentity {
  key?: string | null;
  workKey?: string | null;
}

export function isSameOpenLibraryWork(first: WorkIdentity, second: WorkIdentity) {
  const getWorkId = (book: WorkIdentity) =>
    String(book.workKey || book.key || '').match(/(?:^|\/)works\/(OL\d+W)$/i)?.[1]?.toUpperCase() || '';
  const firstWorkId = getWorkId(first);
  return Boolean(firstWorkId && firstWorkId === getWorkId(second));
}