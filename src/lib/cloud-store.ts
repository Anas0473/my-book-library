import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import type { AstroCookies } from 'astro';
import type { CloudBooks, CloudChange } from './cloud-library.ts';
import { websiteCloudOwner } from './website-auth.ts';

const SESSION_COOKIE = 'library_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
let schemaReady: Promise<void> | undefined;

function connectionString() {
  return process.env.STORAGE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
    || import.meta.env?.STORAGE_URL || import.meta.env?.DATABASE_URL || import.meta.env?.POSTGRES_URL;
}

export function cloudConfigured() {
  return Boolean(connectionString());
}

function database() {
  const url = connectionString();
  if (!url) throw new Error('Cloud storage is not configured.');
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(15000) } });
}

async function ensureSchema() {
  if (!schemaReady) {
    const sql = database();
    schemaReady = sql.transaction([
      sql`CREATE TABLE IF NOT EXISTS library_sessions (
        token_hash text PRIMARY KEY, username text NOT NULL, expires_at timestamptz NOT NULL
      )`,
      sql`CREATE TABLE IF NOT EXISTS cloud_libraries (
        username text PRIMARY KEY, revision integer NOT NULL DEFAULT 0,
        books jsonb NOT NULL DEFAULT '{}'::jsonb,
        CHECK (octet_length(books::text) <= 4000000)
      )`,
      sql`CREATE TABLE IF NOT EXISTS library_account_links (
        openlibrary_username text PRIMARY KEY, website_owner text NOT NULL
      )`,
    ]).then(() => {}).catch(() => {
      schemaReady = undefined;
      throw new Error('Cloud storage initialization failed.');
    });
  }
  await schemaReady;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createCloudSession(cookies: AstroCookies, username: string, secure: boolean) {
  await ensureSchema();
  const sql = database();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await clearCloudSession(cookies);
  await sql`DELETE FROM library_sessions WHERE expires_at <= now()`;
  await sql`INSERT INTO library_sessions (token_hash, username, expires_at)
    VALUES (${tokenHash(token)}, ${username}, ${expiresAt})`;
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS,
  });
}

export async function cloudSessionUser(cookies: AstroCookies): Promise<string | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !cloudConfigured()) return null;
  await ensureSchema();
  const sql = database();
  const rows = await sql`SELECT username FROM library_sessions
    WHERE token_hash = ${tokenHash(token)} AND expires_at > now()`;
  return rows[0]?.username || null;
}

export async function cloudLibraryOwner(cookies: AstroCookies, locals: App.Locals) {
  const websiteOwner = websiteCloudOwner(locals);
  if (websiteOwner) return websiteOwner;
  const legacyOwner = await cloudSessionUser(cookies);
  if (!legacyOwner) return null;
  const sql = database();
  const links = await sql`SELECT website_owner FROM library_account_links
    WHERE openlibrary_username = ${legacyOwner}`;
  return links.length ? null : legacyOwner;
}

export async function linkOpenLibraryAccount(owner: string, username: string, changes: CloudChange[]) {
  await ensureSchema();
  const sql = database();
  // Claim and merge in one transaction; existing website records (including deletions) win.
  const results = await sql.transaction([
    sql`INSERT INTO library_account_links (openlibrary_username, website_owner)
      VALUES (${username}, ${owner}) ON CONFLICT DO NOTHING`,
    sql`INSERT INTO cloud_libraries (username)
      SELECT ${owner} WHERE EXISTS (
        SELECT 1 FROM library_account_links
        WHERE openlibrary_username = ${username} AND website_owner = ${owner}
      ) ON CONFLICT DO NOTHING`,
    sql`INSERT INTO cloud_libraries (username)
      SELECT ${username} WHERE EXISTS (
        SELECT 1 FROM library_account_links
        WHERE openlibrary_username = ${username} AND website_owner = ${owner}
      ) ON CONFLICT DO NOTHING`,
    sql`UPDATE cloud_libraries SET books = books || (
        SELECT coalesce(jsonb_object_agg(entry->>'id', entry->'book'), '{}'::jsonb)
        FROM jsonb_array_elements(${JSON.stringify(changes)}::jsonb) AS entry
        WHERE NOT coalesce((entry->>'importOnly')::boolean, false) OR NOT books ? (entry->>'id')
      ), revision = revision + 1
      WHERE username = ${username} AND EXISTS (
        SELECT 1 FROM library_account_links
        WHERE openlibrary_username = ${username} AND website_owner = ${owner}
      )`,
    sql`UPDATE cloud_libraries AS target SET
        books = coalesce((SELECT books FROM cloud_libraries WHERE username = ${username}), '{}'::jsonb)
          || target.books,
        revision = target.revision + 1
      WHERE target.username = ${owner} AND EXISTS (
        SELECT 1 FROM library_account_links
        WHERE openlibrary_username = ${username} AND website_owner = ${owner}
      ) RETURNING revision`,
  ]);
  return results[4].length > 0;
}

export async function clearCloudSession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  cookies.delete(SESSION_COOKIE, { path: '/' });
  if (!token || !cloudConfigured()) return;
  await ensureSchema();
  const sql = database();
  await sql`DELETE FROM library_sessions WHERE token_hash = ${tokenHash(token)}`;
}

export interface CloudState {
  revision: number;
  books: CloudBooks;
}

export async function readCloudLibrary(username: string): Promise<CloudState> {
  await ensureSchema();
  const sql = database();
  await sql`INSERT INTO cloud_libraries (username) VALUES (${username}) ON CONFLICT DO NOTHING`;
  const rows = await sql`SELECT revision, books FROM cloud_libraries WHERE username = ${username}`;
  return rows[0] as CloudState;
}

export async function writeCloudLibrary(username: string, revision: number, changes: CloudChange[]) {
  await ensureSchema();
  const sql = database();
  const rows = await sql`UPDATE cloud_libraries SET
    books = books || (
      SELECT coalesce(jsonb_object_agg(entry->>'id', entry->'book'), '{}'::jsonb)
      FROM jsonb_array_elements(${JSON.stringify(changes)}::jsonb) AS entry
      WHERE NOT coalesce((entry->>'importOnly')::boolean, false) OR NOT books ? (entry->>'id')
    ), revision = revision + 1
    WHERE username = ${username} AND revision = ${revision}
    RETURNING revision, books`;
  return rows[0] as CloudState | undefined;
}