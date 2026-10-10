import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIContext } from 'astro';
import { GET as cloudGET, PUT as cloudPUT } from '../src/pages/api/cloud-library.json.ts';
import { GET, POST } from '../src/pages/api/website-account.json.ts';
import { websiteCloudOwner } from '../src/lib/website-auth.ts';
import { linkOpenLibraryAccount } from '../src/lib/cloud-store.ts';

interface Query {
  query: string;
  params: string[];
}

function result(rows: Record<string, unknown>[] = []) {
  const names = Object.keys(rows[0] || {});
  return {
    fields: names.map((name) => ({ name, dataTypeID: name === 'books' ? 3802 : name === 'revision' ? 23 : 25 })),
    rows: rows.map((row) => names.map((name) => typeof row[name] === 'object'
      ? JSON.stringify(row[name]) : String(row[name]))),
  };
}

function context(userId: string | null, method = 'GET', body?: unknown) {
  const url = new URL('https://library.example/api/website-account.json');
  return {
    url,
    locals: { auth: () => ({ userId, isAuthenticated: Boolean(userId) }) },
    cookies: { get: () => undefined },
    request: new Request(url, { method, ...(method !== 'GET' ? {
      headers: { Origin: url.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : {}) }),
  } as unknown as APIContext;
}

test('website account authorization and legacy linking', async (t) => {
  const previous = {
    publishable: process.env.PUBLIC_CLERK_PUBLISHABLE_KEY,
    secret: process.env.CLERK_SECRET_KEY,
    storage: process.env.STORAGE_URL,
    fetch: globalThis.fetch,
  };
  process.env.PUBLIC_CLERK_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.CLERK_SECRET_KEY = 'test-secret-key';
  process.env.STORAGE_URL = 'postgresql://test:test@example.neon.tech/library';
  const queries: Query[] = [];
  let claimedBy: string | null = null;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    function execute(query: Query) {
      queries.push(query);
      if (query.query.startsWith('SELECT username FROM library_sessions')) return result([{ username: 'legacy-reader' }]);
      if (query.query.startsWith('SELECT website_owner')) return result(claimedBy ? [{ website_owner: claimedBy }] : []);
      if (query.query.startsWith('SELECT revision, books')) return result([{ revision: 0, books: {} }]);
      if (query.query.startsWith('INSERT INTO library_account_links')) claimedBy ||= query.params[1];
      if (query.query.startsWith('UPDATE cloud_libraries AS target')) {
        return result(query.params[1] === claimedBy ? [{ revision: 1 }] : []);
      }
      if (query.query.startsWith('UPDATE cloud_libraries SET')) return result([{ revision: 1, books: {} }]);
      return result();
    }
    return Response.json(body.queries ? { results: body.queries.map(execute) } : execute(body));
  };
  try {
    await t.test('website identity is derived from verified auth, never an Open Library username', () => {
      assert.equal(websiteCloudOwner(context('user_first').locals), 'clerk:user_first');
      assert.equal(websiteCloudOwner(context(null).locals), null);
      const pending = context('user_first');
      pending.locals = { auth: () => ({ userId: 'user_first', isAuthenticated: false }) } as unknown as App.Locals;
      assert.equal(websiteCloudOwner(pending.locals), null);
    });
    await t.test('signed-out guests cannot read or write cloud books', async () => {
      const before = queries.length;
      assert.equal((await cloudGET(context(null))).status, 401);
      assert.equal((await cloudPUT(context(null, 'PUT', { revision: 0, changes: [] }))).status, 401);
      assert.equal(queries.length, before);
    });
    await t.test('website accounts can read cloud storage without an Open Library session', async () => {
      const response = await cloudGET(context('user_first'));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).username, 'clerk:user_first');
      assert.ok(queries.some((query) => query.params.includes('clerk:user_first')));
    });
    await t.test('Open Library metadata is not used as website account authorization', async () => {
      const response = await cloudPUT(context('user_first', 'PUT', { revision: 0, changes: [{
        id: 'edition:OL1M', book: { title: 'Book', status: 'Read', editionKey: '/books/OL1M',
          openLibrarySyncUsername: 'legacy-reader' },
      }] }));
      assert.equal(response.status, 200);
      const query = queries.at(-1)!;
      assert.ok(query.params.includes('clerk:user_first'));
      assert.ok(query.params.some((param) => param.includes('legacy-reader')));
    });
    await t.test('linking requires website sign-in and a verified Open Library session', async () => {
      assert.equal((await POST(context(null, 'POST', { changes: [] }))).status, 401);
      assert.equal((await POST(context('user_first', 'POST', { changes: [] }))).status, 401);
      const ctx = context('user_first', 'POST', { changes: [] });
      ctx.request = new Request(ctx.url, { method: 'POST',
        headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal((await POST(ctx)).status, 403);
    });
    await t.test('verified linking accepts queued changes only for the verified legacy account', async () => {
      const ctx = context('user_first', 'POST', { changes: [] });
      ctx.cookies = {
        get: (name: string) => ({ value: name === 'ol_session' ? '/people/legacy-reader,verified-session' : 'a'.repeat(64) }),
      } as unknown as APIContext['cookies'];
      const linked = await POST(ctx);
      assert.equal(linked.status, 200);
      assert.equal((await linked.json()).owner, 'clerk:user_first');
      ctx.request = new Request(ctx.url, { method: 'POST',
        headers: { Origin: ctx.url.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: [{ id: 'edition:OL1M', book: {
          title: 'Book', status: 'Read', editionKey: '/books/OL1M', openLibrarySyncUsername: 'someone-else',
        } }] }),
      });
      assert.equal((await POST(ctx)).status, 400);
    });
    await t.test('claiming a legacy library is transactional and cannot be repeated by another account', async () => {
      assert.equal(await linkOpenLibraryAccount('clerk:user_first', 'legacy-reader', []), true);
      assert.equal(await linkOpenLibraryAccount('clerk:user_second', 'legacy-reader', []), false);
      const merge = queries.find((query) => query.query.startsWith('UPDATE cloud_libraries AS target'));
      assert.match(merge!.query, /\|\| target\.books/);
      assert.match(merge!.query, /website_owner = /);
    });
    await t.test('linked legacy sessions cannot access website books after website sign-out', async () => {
      const ctx = context(null);
      ctx.cookies = { get: () => ({ value: 'a'.repeat(64) }) } as unknown as APIContext['cookies'];
      assert.equal((await cloudGET(ctx)).status, 401);
    });
    await t.test('account status reports independent website ownership', async () => {
      const response = await GET(context('user_first'));
      assert.deepEqual(await response.json(), { configured: true, signedIn: true,
        owner: 'clerk:user_first', cloudOwner: 'clerk:user_first', cloudConfigured: true });
    });
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ['PUBLIC_CLERK_PUBLISHABLE_KEY', previous.publishable],
      ['CLERK_SECRET_KEY', previous.secret],
      ['STORAGE_URL', previous.storage],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
