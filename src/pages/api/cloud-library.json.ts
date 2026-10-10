import type { APIRoute } from 'astro';
import { validateCloudChanges } from '../../lib/cloud-library.ts';
import { cloudConfigured, cloudLibraryOwner, readCloudLibrary, writeCloudLibrary } from '../../lib/cloud-store.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ cookies, locals }) => {
  if (!cloudConfigured()) return json({ error: 'Cloud storage is not configured.' }, 503);
  try {
    const username = await cloudLibraryOwner(cookies, locals);
    if (!username) return json({ error: 'Sign in to enable cloud library sync.' }, 401);
    return json({ username, ...await readCloudLibrary(username) });
  } catch {
    return json({ error: 'Cloud library could not be loaded. Your browser books were kept.' }, 503);
  }
};

export const PUT: APIRoute = async ({ request, cookies, url, locals }) => {
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Cross-site writes are not allowed.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Expected JSON.' }, 415);
  if (!cloudConfigured()) return json({ error: 'Cloud storage is not configured.' }, 503);
  try {
    const username = await cloudLibraryOwner(cookies, locals);
    if (!username) return json({ error: 'Sign in to enable cloud library sync.' }, 401);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Missing changes.' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1000000) {
        await reader.cancel();
        return json({ error: 'Too many changes. Try syncing fewer books at once.' }, 413);
      }
      chunks.push(value);
    }
    let body;
    let changes;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('Invalid revision.');
      changes = validateCloudChanges(body.changes);
      if (!username.startsWith('clerk:') && changes.some((change) => change.book?.openLibrarySyncUsername
        && change.book.openLibrarySyncUsername !== username)) throw new Error('Wrong book owner.');
    } catch {
      return json({ error: 'Invalid cloud library changes.' }, 400);
    }
    const saved = await writeCloudLibrary(username, body.revision, changes);
    if (!saved) return json({ username, ...await readCloudLibrary(username) }, 409);
    return json({ username, ...saved });
  } catch {
    return json({ error: 'Cloud library could not be saved. Your browser books were kept.' }, 503);
  }
};