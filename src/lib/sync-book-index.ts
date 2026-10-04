interface SyncBookIdentity {
  key?: string | null;
  workKey?: string | null;
  editionKey?: string | null;
  loggedEditionKey?: string | null;
}

// Use when at least one side is synced: logged editions, then works, then the fallback matcher.
export function createSyncBookIndex<T extends SyncBookIdentity>(
  initialBooks: T[],
  matches: (existing: T, incoming: T) => boolean,
) {
  const books: T[] = [];
  const byEdition = new Map<string, Set<number>>();
  const byWork = new Map<string, Set<number>>();
  const byWorkWithoutEdition = new Map<string, Set<number>>();
  const withoutWork = new Set<number>();
  const withoutWorkOrEdition = new Set<number>();
  const withoutEdition = new Set<number>();
  const all = new Set<number>();
  const editionKey = (book: T) => book.loggedEditionKey || book.editionKey;
  const workKey = (book: T) => book.workKey || book.key;

  function bucket(map: Map<string, Set<number>>, key: string) {
    let indices = map.get(key);
    if (!indices) {
      indices = new Set<number>();
      map.set(key, indices);
    }
    return indices;
  }

  function bucketsFor(book: T) {
    const edition = editionKey(book);
    const work = workKey(book);
    const buckets = [all];
    if (edition) buckets.push(bucket(byEdition, edition));
    else buckets.push(withoutEdition);
    if (work) {
      buckets.push(bucket(byWork, work));
      if (!edition) buckets.push(bucket(byWorkWithoutEdition, work));
    } else {
      buckets.push(withoutWork);
      if (!edition) buckets.push(withoutWorkOrEdition);
    }
    return buckets;
  }

  function set(index: number, book: T) {
    if (books[index]) bucketsFor(books[index]).forEach((indices) => indices.delete(index));
    books[index] = book;
    bucketsFor(book).forEach((indices) => indices.add(index));
  }

  initialBooks.forEach((book, index) => set(index, book));

  function findIndex(book: T) {
    const edition = editionKey(book);
    const work = workKey(book);
    const candidates = [edition ? byEdition.get(edition) : undefined];
    if (work) {
      candidates.push(
        edition ? byWorkWithoutEdition.get(work) : byWork.get(work),
        edition ? withoutWorkOrEdition : withoutWork,
      );
    } else {
      candidates.push(edition ? withoutEdition : all);
    }
    let first = Infinity;
    for (const indices of candidates) {
      if (!indices) continue;
      for (const index of indices) {
        if (index < first && matches(books[index], book)) first = index;
      }
    }
    return first === Infinity ? -1 : first;
  }

  return {
    findIndex,
    find(book: T) {
      const index = findIndex(book);
      return index < 0 ? undefined : books[index];
    },
    set,
  };
}
