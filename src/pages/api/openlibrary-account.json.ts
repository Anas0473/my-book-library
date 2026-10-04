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
  const body = await request.json().catch(() => ({}));
  const field = (name: string) => (typeof body?.[name] === 'string' ? body[name].trim() : '');
  const usesKeys = Boolean(field('access') || field('secret'));
  if (usesKeys ? !field('access') || !field('secret') : !field('email') || !body?.password) {
    return jsonResponse({
      error: usesKeys
        ? 'Enter both your access key and secret key.'
        : 'Enter your Open Library email and password.',
    }, 400);
  }

  try {
    const { session, username } = await loginToOpenLibrary(usesKeys
      ? { access: field('access'), secret: field('secret') }
      : { email: field('email'), password: String(body.password) });
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
