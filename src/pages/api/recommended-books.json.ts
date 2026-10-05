import type { APIRoute } from 'astro';

const CACHE_MS = 30 * 60 * 1000;
const MAX_SEEDS = 12;
const MAX_SUBJECTS = 5;
const WORKS_PER_SUBJECT = 50;
const MAX_LANGUAGE_FILTER_CANDIDATES = 60;
const MAX_RECOMMENDATION_BOOKS = 40;
const MAX_CACHED_RECORDS = 500;
const MAX_RECOMMENDATION_RESULTS = 100;
const cache = new Map<string, { expiresAt: number; data: any }>();
const recommendationCache = new Map<string, { expiresAt: number; books: any[]; partial: boolean }>();
const ignoredSubjects = new Set([
  'accessible book',
  'books',
  'fiction',
  'in library',
  'literature',
  'nonfiction',
  'open library staff picks',
  'protected daisy',
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cacheRecord(path: string, data: any) {
  if (cache.size >= MAX_CACHED_RECORDS) {
    const oldestPath = cache.keys().next().value;
    if (oldestPath) cache.delete(oldestPath);
  }
  cache.set(path, { expiresAt: Date.now() + CACHE_MS, data });
}

async function fetchOpenLibrary(path: string) {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://openlibrary.org${path}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'my-book-library/0.0.1' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Open Library responded with ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Open Library returned invalid recommendation data.');
    }
    cacheRecord(path, data);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function getWorkKey(seed: string): Promise<string | null> {
  if (seed.startsWith('/works/')) return seed;
  const edition = await fetchOpenLibrary(`${seed}.json`);
  const workKey = Array.isArray(edition?.works) ? edition.works[0]?.key : null;
  return typeof workKey === 'string' && /^\/works\/OL\d+W$/i.test(workKey) ? workKey : null;
}

async function subjectsForSeed(seed: string): Promise<{ workKey: string | null; subjects: string[] }> {
  const workKey = await getWorkKey(seed);
  if (!workKey) return { workKey: null, subjects: [] };
  const work = await fetchOpenLibrary(`${workKey}.json`);
  const subjects = Array.isArray(work?.subjects) ? work.subjects : [];
  return {
    workKey,
    subjects: subjects.filter((subject: unknown): subject is string =>
      typeof subject === 'string'
      && subject.trim().length >= 4
      && !ignoredSubjects.has(subject.trim().toLowerCase()),
    ),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await map(items[index]);
    }
  }));
  return results;
}

function selectPreferredEdition(editions: any[], preferredLanguages: string[]) {
  const languageRank = new Map(preferredLanguages.map((language, index) => [language, index]));
  return editions
    .filter((edition) => /^\/books\/OL\d+M$/i.test(edition?.key || ''))
    .map((edition) => {
      const languages = Array.isArray(edition.languages)
        ? edition.languages.map((item: any) => String(item?.key || '').split('/').pop().toLowerCase())
        : [];
      const matchingLanguage = preferredLanguages.find((language) => languages.includes(language));
      return matchingLanguage ? { edition, matchingLanguage } : null;
    })
    .filter((item): item is { edition: any; matchingLanguage: string } => item !== null)
    .sort((first, second) => {
      const firstLanguageRank = languageRank.get(first.matchingLanguage) ?? preferredLanguages.length;
      const secondLanguageRank = languageRank.get(second.matchingLanguage) ?? preferredLanguages.length;
      if (firstLanguageRank !== secondLanguageRank) return firstLanguageRank - secondLanguageRank;

      const firstCover = Array.isArray(first.edition.covers)
        && first.edition.covers.some((cover: unknown) => Number(cover) > 0);
      const secondCover = Array.isArray(second.edition.covers)
        && second.edition.covers.some((cover: unknown) => Number(cover) > 0);
      if (firstCover !== secondCover) return firstCover ? -1 : 1;

      const publicationYear = (edition: any) => {
        const dates = Array.isArray(edition.publish_date) ? edition.publish_date : [edition.publish_date];
        const years = dates.map((date: unknown) => String(date || '').match(/\b\d{4}\b/)?.[0] || '');
        return Math.max(0, ...years.map(Number));
      };
      return publicationYear(second.edition) - publicationYear(first.edition);
    })[0] || null;
}

function mapRecommendedWork(work: any, edition: any = null, selectedLanguage = '') {
  const authors = Array.isArray(work.authors) ? work.authors : [];
  const authorKeys = authors
    .map((author: any) => String(author.key || '').split('/').pop())
    .filter(Boolean);
  const authorNames = authors.map((author: any) => author.name).filter(Boolean);
  const coverId = Number(work.cover_id) || 0;
  const editionId = String(edition?.key || '').match(/OL\d+M/i)?.[0].toUpperCase() || '';
  const editionCoverId = Array.isArray(edition?.covers)
    ? edition.covers.find((id: unknown) => Number(id) > 0)
    : null;
  const editionLanguage = selectedLanguage
    || edition?.languages?.[0]?.key?.split('/').pop()
    || '';
  return {
    key: work.key,
    workKey: work.key,
    editionKey: edition?.key || '',
    editionUrl: editionId ? `https://openlibrary.org/books/${editionId}` : '',
    editionLanguage,
    editionKeys: editionId ? [editionId] : [],
    editionHeroImage: editionCoverId
      ? `https://covers.openlibrary.org/b/id/${editionCoverId}-M.jpg`
      : editionId
        ? `https://covers.openlibrary.org/b/olid/${editionId}-M.jpg?default=false`
        : '',
    title: edition?.title || work.title,
    subtitle: edition?.subtitle || '',
    author: authorNames.length ? authorNames.join(', ') : 'Unknown Author',
    authorKeys,
    publisher: edition?.publishers?.[0] || '',
    editionCount: Number(work.edition_count) || 0,
    pubDate: Array.isArray(edition?.publish_date)
      ? edition.publish_date[0] || String(work.first_publish_year || '')
      : edition?.publish_date || String(work.first_publish_year || ''),
    isbn: edition?.isbn_13?.[0] || edition?.isbn_10?.[0] || '',
    heroImage: editionCoverId
      ? `https://covers.openlibrary.org/b/id/${editionCoverId}-M.jpg`
      : coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
    subjects: Array.isArray(work.subject) ? work.subject : [],
  };
}

export const GET: APIRoute = async ({ url }) => {
  const requestedSeeds = url.searchParams.getAll('seed');
  const requestedLanguages = url.searchParams.getAll('language');
  if (requestedSeeds.length === 0 || requestedSeeds.length > MAX_SEEDS) {
    return jsonResponse({ error: `Provide between 1 and ${MAX_SEEDS} books for recommendations.` }, 400);
  }
  const seeds = requestedSeeds.map((seed) => {
    const normalized = seed.startsWith('/') ? seed : `/${seed}`;
    const match = normalized.match(/^\/(works|books)\/(OL\d+[WM])$/i);
    return match ? `/${match[1].toLowerCase()}/${match[2].toUpperCase()}` : null;
  });
  if (seeds.some((seed) => !seed)) {
    return jsonResponse({ error: 'One or more book IDs are invalid.' }, 400);
  }
  if (requestedLanguages.some((language) =>
    !/^[a-z]{2,3}$/i.test(language) || ['und', 'mul', 'zxx'].includes(language.toLowerCase()),
  )) {
    return jsonResponse({ error: 'One or more preferred languages are invalid.' }, 400);
  }
  const preferredLanguages = Array.from(new Set(requestedLanguages.map((language) => language.toLowerCase())));
  if (preferredLanguages.length > 10) {
    return jsonResponse({ error: 'Provide no more than 10 preferred languages.' }, 400);
  }

  const uniqueSeeds = Array.from(new Set(seeds.filter((seed): seed is string => seed !== null)));
  const resultCacheKey = JSON.stringify([uniqueSeeds, preferredLanguages]);
  const cachedRecommendations = recommendationCache.get(resultCacheKey);
  if (cachedRecommendations && cachedRecommendations.expiresAt > Date.now()) {
    return jsonResponse({
      books: cachedRecommendations.books,
      partial: cachedRecommendations.partial,
    });
  }

  try {
    const seedDetails = await mapWithConcurrency(uniqueSeeds, 4, subjectsForSeed);
    const subjectCounts = new Map<string, { subject: string; count: number; order: number }>();
    let nextSubjectOrder = 0;
    for (const { subjects } of seedDetails) {
      for (const subject of new Set(subjects)) {
        const key = subject.trim().toLowerCase();
        const current = subjectCounts.get(key);
        subjectCounts.set(key, {
          subject: current?.subject || subject.trim(),
          count: (current?.count || 0) + 1,
          order: current?.order ?? nextSubjectOrder++,
        });
      }
    }
    const selectedSubjects = Array.from(subjectCounts.values())
      .sort((first, second) => second.count - first.count || first.order - second.order)
      .slice(0, MAX_SUBJECTS);
    if (!selectedSubjects.length) return jsonResponse({ books: [] });

    const recommendations = new Map<string, { work: any; score: number }>();
    await mapWithConcurrency(selectedSubjects, 3, async ({ subject }) => {
      const slug = subject.toLowerCase().trim().replace(/\s+/g, '_');
      const data = await fetchOpenLibrary(`/subjects/${encodeURIComponent(slug)}.json?limit=${WORKS_PER_SUBJECT}`);
      const works = Array.isArray(data?.works) ? data.works : [];
      for (const work of works) {
        if (!work?.key || !/^\/works\/OL\d+W$/i.test(work.key) || !work.title) continue;
        const current = recommendations.get(work.key);
        recommendations.set(work.key, {
          work: current?.work || work,
          score: (current?.score || 0) + 1,
        });
      }
    });

    const seedWorkKeys = new Set(seedDetails.map((seed) => seed.workKey).filter(Boolean));
    const rankedWorks = Array.from(recommendations.entries())
      .filter(([key]) => !seedWorkKeys.has(key))
      .sort((first, second) =>
        second[1].score - first[1].score
        || (Number(second[1].work.edition_count) || 0) - (Number(first[1].work.edition_count) || 0)
        || String(first[1].work.title).localeCompare(String(second[1].work.title)),
      );
    let books: any[];
    let partial = false;
    if (preferredLanguages.length) {
      const candidates = rankedWorks.slice(0, MAX_LANGUAGE_FILTER_CANDIDATES);
      let failedEditionLookups = 0;
      const matchingEditions = await mapWithConcurrency(candidates, 6, async ([, result]) => {
        try {
          const workKey = result.work.key.replace(/^\/+/, '');
          const params = new URLSearchParams({
            limit: '1000',
            fields: 'key,title,subtitle,publish_date,publishers,isbn_10,isbn_13,covers,languages',
          });
          const editions = await fetchOpenLibrary(`/${workKey}/editions.json?${params}`);
          return selectPreferredEdition(Array.isArray(editions?.entries) ? editions.entries : [], preferredLanguages);
        } catch {
          failedEditionLookups++;
          return null;
        }
      });
      books = candidates.flatMap(([, result], index) =>
        matchingEditions[index]
          ? [mapRecommendedWork(
              result.work,
              matchingEditions[index].edition,
              matchingEditions[index].matchingLanguage,
            )]
          : [],
      );
      books = books.slice(0, MAX_RECOMMENDATION_BOOKS);
      partial = failedEditionLookups > 0;
      if (partial) {
        console.warn(
          `Open Library recommendations returned partial results; ${failedEditionLookups} of ${candidates.length} edition lookups failed.`,
        );
      }
    } else {
      books = rankedWorks.map(([, result]) => mapRecommendedWork(result.work));
    }
    if (recommendationCache.size >= MAX_RECOMMENDATION_RESULTS) {
      const oldestKey = recommendationCache.keys().next().value;
      if (oldestKey) recommendationCache.delete(oldestKey);
    }
    recommendationCache.set(resultCacheKey, {
      expiresAt: Date.now() + (partial ? 2 * 60 * 1000 : CACHE_MS),
      books,
      partial,
    });
    return jsonResponse({ books, partial });
  } catch (error) {
    console.error('Could not load Open Library recommendations:', error);
    return jsonResponse({ error: 'Could not load recommendations from Open Library. Please try again.' }, 502);
  }
};
