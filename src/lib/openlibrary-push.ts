export const SHELF_STATUSES = ['Plan to Read', 'Reading', 'Read'];

export interface ShelfEntry {
  status: string;
  editionId: string;
  removed: boolean;
  dateAdded: number;
}

export interface ShelfChange {
  workId: string;
  status: string | null;
  editionKey: string | null;
}

export function workIdOf(book: any) {
  return String(book?.workKey || book?.key || '').match(/OL\d+W/i)?.[0].toUpperCase() || '';
}

function editionIdOf(book: any) {
  return String(book?.loggedEditionKey || book?.editionKey || '').match(/OL\d+M/i)?.[0].toUpperCase() || '';
}

/** One entry per Open Library work; when a work is saved twice, the most recently added copy wins. */
export function shelfSnapshot(books: any[]) {
  const snapshot = new Map<string, ShelfEntry>();
  books.forEach((book) => {
    const workId = workIdOf(book);
    if (!workId || !SHELF_STATUSES.includes(book?.status)) return;
    const entry = {
      status: book.status,
      editionId: editionIdOf(book),
      removed: Boolean(book.openLibraryRemoved),
      dateAdded: Number(book.dateAdded) || 0,
    };
    const existing = snapshot.get(workId);
    if (!existing || entry.dateAdded >= existing.dateAdded) snapshot.set(workId, entry);
  });
  return snapshot;
}

/** The Open Library shelf changes needed to go from one saved list to the next. */
export function diffShelves(previous: Map<string, ShelfEntry>, next: Map<string, ShelfEntry>) {
  const changes: ShelfChange[] = [];
  next.forEach((entry, workId) => {
    const before = previous.get(workId);
    // Books removed on Open Library stay here, flagged, until they are moved again.
    if (entry.removed && (!before || !before.removed || before.status === entry.status)) return;
    if (
      before
      && !before.removed
      && before.status === entry.status
      && (before.editionId === entry.editionId || !entry.editionId)
    ) return;
    changes.push({
      workId,
      status: entry.status,
      editionKey: entry.editionId ? `/books/${entry.editionId}` : null,
    });
  });
  previous.forEach((entry, workId) => {
    if (!next.has(workId) && !entry.removed) changes.push({ workId, status: null, editionKey: null });
  });
  return changes;
}

/** Later changes to the same work replace earlier ones that have not been sent yet. */
export function mergePendingChanges(pending: ShelfChange[], changes: ShelfChange[]) {
  const merged = new Map(pending.map((change) => [change.workId, change]));
  changes.forEach((change) => {
    merged.delete(change.workId);
    merged.set(change.workId, change);
  });
  return [...merged.values()];
}
