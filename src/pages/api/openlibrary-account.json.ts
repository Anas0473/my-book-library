import type { APIRoute } from 'astro';
import {
  clearSession,
  getSession,
  loginToOpenLibrary,
  setSession,
} from '../../lib/openlibrary-session';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = ({ cookies }) => {
  const session = getSession(cookies);
  return jsonResponse({ connected: Boolean(session), username: session?.username || null });
};

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'Expected JSON.' }, 415);
  }
  const { email = '', password = '' } = await request.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return jsonResponse({ error: 'Enter your Open Library email and password.' }, 400);
  }

  try {
    const { session, username } = await loginToOpenLibrary(email.trim(), password);
    setSession(cookies, session, url.protocol === 'https:');
    return jsonResponse({ connected: true, username });
  } catch (error) {
    const message = error instanceof Error && error.name !== 'AbortError'
      ? error.message
      : 'Open Library took too long to answer. Try again.';
    return jsonResponse({ error: message }, 401);
  }
};

export const DELETE: APIRoute = ({ cookies }) => {
  clearSession(cookies);
  return jsonResponse({ connected: false, username: null });
};
