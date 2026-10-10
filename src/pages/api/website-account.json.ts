import type { APIRoute } from 'astro';
import { cloudConfigured, cloudLibraryOwner, cloudSessionUser, linkOpenLibraryAccount } from '../../lib/cloud-store.ts';
import { websiteAuthConfigured, websiteCloudOwner } from '../../lib/website-auth.ts';
import { validateCloudChanges } from '../../lib/cloud-library.ts';
import { getSession } from '../../lib/openlibrary-session.ts';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET: APIRoute = async ({ locals, cookies }) => {
  try {
    const owner = websiteCloudOwner(locals);
    const cloudOwner = cloudConfigured() ? await cloudLibraryOwner(cookies, locals)
      : owner || getSession(cookies)?.username || null;
    return json({ configured: websiteAuthConfigured(), signedIn: Boolean(owner),
      owner, cloudOwner, cloudConfigured: cloudConfigured() });
  } catch (error) {
    console.error('Website account could not be loaded.', error);
    return json({ error: 'Account sync is unavailable. Your device books were kept.' }, 503);
  }
};

export const POST: APIRoute = async ({ locals, cookies, request, url }) => {
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Cross-site linking is not allowed.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Expected JSON.' }, 415);
  const owner = websiteCloudOwner(locals);
  if (!owner) return json({ error: 'Sign in to your website account first.' }, 401);
  if (!cloudConfigured()) return json({ error: 'Cloud storage is not configured.' }, 503);
  try {
    const username = await cloudSessionUser(cookies);
    if (!username || getSession(cookies)?.username !== username) {
      return json({ error: 'Log in to Open Library again to verify and link your existing library.' }, 401);
    }
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Missing library changes.' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1000000) {
        await reader.cancel();
        return json({ error: 'Too many changes to link at once. Your saved books were kept.' }, 413);
      }
      chunks.push(value);
    }
    let changes;
    try {
      changes = validateCloudChanges(JSON.parse(Buffer.concat(chunks).toString('utf8')).changes);
      if (changes.some((change) => change.book?.openLibrarySyncUsername
        && change.book.openLibrarySyncUsername !== username)) throw new Error('Wrong book owner.');
    } catch {
      return json({ error: 'Invalid library changes.' }, 400);
    }
    if (!await linkOpenLibraryAccount(owner, username, changes)) {
      return json({ error: 'This Open Library library is already linked to another website account.' }, 409);
    }
    return json({ linked: true, username, owner });
  } catch (error) {
    console.error('Open Library account linking failed.', error);
    return json({ error: 'Could not link your existing library. Your saved books were kept.' }, 503);
  }
};
