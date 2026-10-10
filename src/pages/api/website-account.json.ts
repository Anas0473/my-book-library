import type { APIRoute } from 'astro';
import { cloudConfigured, cloudLibraryOwner } from '../../lib/cloud-store.ts';
import { websiteAuthConfigured, websiteCloudOwner } from '../../lib/website-auth.ts';
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
