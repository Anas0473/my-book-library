import type { APIRoute } from 'astro';
import { SHELF_IDS, clearSession, getSession, updateOpenLibraryShelf } from '../../lib/openlibrary-session';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'Expected JSON.' }, 415);
  }
  const session = getSession(cookies);
  if (!session) return jsonResponse({ error: 'Log in to Open Library first.', loggedOut: true }, 401);

  const { workKey, editionKey = null, status = null } = await request.json().catch(() => ({}));
  if (typeof workKey !== 'string' || !/OL\d+W/i.test(workKey)) {
    return jsonResponse({ error: 'This book has no Open Library work.' }, 400);
  }
  if (status !== null && !SHELF_IDS[status]) {
    return jsonResponse({ error: 'Unknown shelf.' }, 400);
  }

  try {
    const result = await updateOpenLibraryShelf(session.session, workKey, status, editionKey);
    if (result.status === 401 || result.status === 403) {
      clearSession(cookies);
      return jsonResponse({ error: 'Your Open Library login expired. Log in again.', loggedOut: true }, 401);
    }
    if (!result.ok) {
      return jsonResponse({ error: result.data?.error || result.data?.detail || 'Open Library rejected the change.' }, 502);
    }
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: 'Could not reach Open Library.' }, 502);
  }
};
