import type { AstroCookies } from 'astro';

export const OPEN_LIBRARY_SESSION_COOKIE = 'ol_session';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const USER_AGENT = 'my-book-library/0.0.1';

export const SHELF_IDS: Record<string, number> = {
  'Plan to Read': 1,
  Reading: 2,
  Read: 3,
};

export function usernameFromSession(session: string | undefined) {
  if (!session) return null;
  let decoded = session;
  try {
    decoded = decodeURIComponent(session);
  } catch {
    // Keep the raw value when it is not URI-encoded.
  }
  return decoded.match(/^\/people\/([^,/]+),/)?.[1] || null;
}

export function getSession(cookies: AstroCookies) {
  const session = cookies.get(OPEN_LIBRARY_SESSION_COOKIE)?.value;
  const username = usernameFromSession(session);
  return session && username ? { session, username } : null;
}

export function setSession(cookies: AstroCookies, session: string, secure: boolean) {
  cookies.set(OPEN_LIBRARY_SESSION_COOKIE, session, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
}

export function clearSession(cookies: AstroCookies) {
  cookies.delete(OPEN_LIBRARY_SESSION_COOKIE, { path: '/' });
}

export function sessionHeaders(session: string) {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Cookie: `session=${session}`,
  };
}

function loginErrorFromPage(html: string) {
  const match = html.match(/<div class="error[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const text = match?.[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || 'Open Library did not accept those login details.';
}

export type OpenLibraryCredentials =
  | { email: string; password: string }
  | { access: string; secret: string };

/** Logs in with an email and password, or with Internet Archive S3 keys (for accounts made with Google). */
export async function loginToOpenLibrary(credentials: OpenLibraryCredentials) {
  const fields: Record<string, string> = 'access' in credentials
    ? { access: credentials.access, secret: credentials.secret }
    : { username: credentials.email, password: credentials.password };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://openlibrary.org/account/login', {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ ...fields, remember: 'true', redirect: '/' }),
    });
    const sessionCookie = response.headers
      .getSetCookie()
      .map((cookie) => cookie.match(/^session=([^;]*)/)?.[1])
      .find(Boolean);
    const username = usernameFromSession(sessionCookie);
    if (sessionCookie && username) return { session: sessionCookie, username };
    if (response.status >= 500) throw new Error('Open Library is not responding right now. Try again later.');
    throw new Error(loginErrorFromPage(await response.text()));
  } finally {
    clearTimeout(timeout);
  }
}

export async function updateOpenLibraryShelf(
  session: string,
  workKey: string,
  status: string | null,
  editionKey?: string | null,
) {
  const workId = workKey.match(/OL\d+W/i)?.[0].toUpperCase();
  if (!workId) throw new Error('This book has no Open Library work.');
  const shelfId = status ? SHELF_IDS[status] : -1;
  if (!shelfId) throw new Error('Unknown shelf.');

  const body = new URLSearchParams({ bookshelf_id: String(shelfId) });
  if (shelfId !== -1) {
    body.set('dont_remove', 'true');
    const editionId = String(editionKey || '').match(/OL\d+M/i)?.[0].toUpperCase();
    if (editionId) body.set('edition_id', `/books/${editionId}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://openlibrary.org/works/${workId}/bookshelves.json`, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: { ...sessionHeaders(session), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && !data?.error, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}
