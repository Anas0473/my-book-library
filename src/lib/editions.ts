// Finds the best matching edition, preferring editions with covers and then newer dates.
export async function findMatchingEdition(
  workKey: string,
  normalizedQuery: string,
  language?: string,
  timeoutMs = 5000,
  preferNewest = false,
) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const params = new URLSearchParams({
      limit: language ? '1000' : '100',
      fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages',
    });
    let response: Response;
    try {
      response = await fetch(`https://openlibrary.org/${workKey}/editions.json?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'my-book-library/0.0.1' },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;

    const data = await response.json();
    const entries = (data.entries || []).filter((edition: any) => /^\/books\/OL\d+M$/i.test(edition.key || ''));
    const normalizedTitle = (edition: any) => String(edition.title || '').trim().toLocaleLowerCase();
    const languageEntries = language
      ? entries.filter((edition: any) =>
          (edition.languages || []).some((item: any) =>
            String(item.key || '').split('/').pop() === language,
          ),
        )
      : entries;
    const newestWithCover = (candidates: any[]) => {
      const withCovers = candidates.filter((edition: any) =>
        Array.isArray(edition.covers) && edition.covers.some((coverId: any) => Number(coverId) > 0),
      );
      const editionsToRank = withCovers.length > 0 ? withCovers : candidates;
      const publicationTime = (edition: any) => {
        const dates = Array.isArray(edition.publish_date)
          ? edition.publish_date
          : [edition.publish_date];
        const parsedDates = dates
          .map((date: any) => Date.parse(String(date || '')))
          .filter(Number.isFinite);
        if (parsedDates.length > 0) return Math.max(...parsedDates);
        const year = String(dates[0] || '').match(/\b\d{4}\b/)?.[0];
        return year ? Date.UTC(Number(year), 0, 1) : 0;
      };
      return [...editionsToRank].sort((first: any, second: any) =>
        publicationTime(second) - publicationTime(first),
      )[0] || null;
    };
    const titleMatches = languageEntries.filter(
      (edition: any) => normalizedTitle(edition).includes(normalizedQuery),
    );
    if (preferNewest) return newestWithCover(titleMatches) || newestWithCover(languageEntries);
    return (
      (language ? newestWithCover(languageEntries) : null) ||
      newestWithCover(titleMatches) ||
      null
    );
  } catch {
    return null;
  }
}
