import type { APIRoute } from 'astro';
import { clearCloudSession, cloudConfigured, cloudLibraryOwner, createCloudSession } from '../../lib/cloud-store';
import { websiteCloudOwner } from '../../lib/website-auth';
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

export const GET: APIRoute = async ({ cookies, locals }) => {
  const session = getSession(cookies);
  let cloudConnected = false;
  try {
    cloudConnected = Boolean(session && await cloudLibraryOwner(cookies, locals) === session.username);
  } catch {
    return jsonResponse({ connected: Boolean(session), username: session?.username || null,
      cloudConfigured: cloudConfigured(), cloudConnected: false, cloudError: 'Cloud library is temporarily unavailable.' });
  }
  return jsonResponse({ connected: Boolean(session), username: session?.username || null,
    cloudConfigured: cloudConfigured(), cloudConnected });
};

export const POST: APIRoute = async ({ request, cookies, url, locals }) => {
  if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
    return jsonResponse({ error: 'Cross-site login is not allowed.' }, 403);
  }
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
    let cloudError: string | undefined;
    if (cloudConfigured()) {
      try {
        await createCloudSession(cookies, username, url.protocol === 'https:');
      } catch {
        if (!websiteCloudOwner(locals)) {
          return jsonResponse({ error: 'Cloud storage could not be reached. Your saved books were kept; please try logging in again.' }, 503);
        }
        cloudError = 'Open Library connected, but account linking is unavailable. Try again later.';
      }
    }
    setSession(cookies, session, url.protocol === 'https:');
    const cloudConnected = !cloudError && cloudConfigured()
      && await cloudLibraryOwner(cookies, locals) === username;
    return jsonResponse({ connected: true, username, cloudConfigured: cloudConfigured(), cloudConnected, cloudError });
  } catch (error) {
    const message = error instanceof Error && error.name !== 'AbortError'
      ? error.message
      : 'Open Library took too long to answer. Try again.';
    return jsonResponse({ error: message }, 401);
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  if (request.headers.get('origin') !== url.origin) return jsonResponse({ error: 'Cross-site logout is not allowed.' }, 403);
  try {
    await clearCloudSession(cookies);
  } catch {
    return jsonResponse({ error: 'Could not log out of cloud storage. Please try again.' }, 503);
  }
  clearSession(cookies);
  return jsonResponse({ connected: false, username: null });
};
