# Astro Starter Kit: Blog

```sh
npm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## Reading list controls

The Appearance picker preserves your exact background color. Panel, input, and
selected-state colors adapt to it, with contrast-checked primary and secondary
text, accent text, and keyboard focus indicators.

Click an unsaved book's status button to add it to Plan to Read. Click a yellow
status button to remove the book from My Lists; use the arrow to choose a different
list. Up to two separate Undo notifications are shown for the latest actions.
Edition previews scale to the window height and expand while the list menu is open,
so all list options stay visible without scrolling. On roomy desktop windows,
edition previews use the same cover size and dialog width as Book details.
Each individual removal has its own Undo button and expires after six seconds,
independently of the other notification. Notifications include the book's subtitle
when available so books with the same title can be distinguished. Adding a removed book again dismisses
its outdated notification. Batch deletions use one notification to undo the
entire batch.
Press Ctrl+Z (Command+Z on Mac) to trigger the latest available Undo notification.
The same six-second expiry and two-notification limit apply. Typing in an input,
textarea or editable area keeps the browser's normal text undo; the shortcut does
not override text editing or add redo.

In Book details or an edition preview, click the cover (or focus it and press Enter)
to open the full-size cover viewer. Click the viewer or press Escape to return
to the details.

Search results use the same Book details and edition previews as My Lists.
Click a result's cover, title, or non-interactive area to view its details.
Browse editions opens the edition list; selecting an edition shows its details
and lets you add that specific edition to a list without changing the search result.

Search results are paged to fit the window: wide layouts with 7 or more books
per row show 2 rows per page, and narrower layouts show 3 rows (always at least
12 books). Resizing the window recalculates the page size and keeps the first
book you were viewing on screen.

Before you search, Search books shows trending books from Open Library, with
tabs for Today, This week and This month. It opens on Today and fills the same
number of rows as a search results page; Show more trending books adds more rows.
With "Hide books in my
lists" turned on, books you've already added are skipped and replaced by the
next trending ones.
The discovery area also has a Recommended for you tab. It uses subjects and
languages from books in Read, Reading and Plan to Read to find related Open
Library works with editions in those languages, then hides books already in
your lists. Add more books to those lists to refresh and improve recommendations.

When syncing from Open Library, a logged edition without a cover is shown as the
work's newest edition that has one. Editions you pick in this app are kept as chosen.
Sync reads edition records in batches from Open Library's Books API rather than
its search index, so cover changes appear on the next successful sync even when
the index is out of date. Failed edition lookups fail the sync without replacing
your saved books.
Edition details are fetched in batches of up to 50 to reduce requests and waiting.
Every sync still refreshes all books, with the same request pacing and failure
checks; no saved metadata is used to hide a failed lookup. Shelf and edition-detail
reads allow 20 seconds per attempt and retry up to twice after a timeout, network failure
or temporary HTTP error. Retries use exponential backoff starting at 1.1 seconds and respect Retry-After
up to 30 seconds; longer delays fail the sync instead of retrying early.
Failed reads still stop the sync without replacing saved books, and exhausted
timeouts show a specific warning. Invalid shelf pages also fail rather than being
treated as empty shelves. Login and shelf-write requests are not retried by this logic.
Click outside the Open Library connection dialog, press Escape, or choose Cancel
to close it without starting a sync.
Open Library connections use two-way sync only; log in to connect or sync.
Books previously imported by username stay saved, but no longer sync until you
log in. Already logged-in accounts keep their connected-account view.
On touch screens, the keyboard stays closed until you tap a login field.
The connection dialog separates sync benefits, account-switch guidance and login
instructions, with grouped fields and descriptive links for Internet Archive keys.
List cards are inserted and reordered in batches, without moving them when the
order is unchanged. Sync matching uses indexed candidates with the same edition,
work and fallback matching rules. Edition sorting computes publication dates once
per request without changing the order or featured picks.

To sync both ways, log in with your Open Library email and password in that
dialog. If you signed up for Open Library with Google, you have no password, so
choose "Signed up with Google?" and paste your Internet Archive access and secret
keys from https://archive.org/account/s3.php (sign in to archive.org with Google
first). The password or keys are sent only to Open Library to log in and are never stored.
The site keeps Open Library's login session in an HTTP-only cookie. While you're
logged in, adding, moving or deleting a book here also does it on Open Library, and
changes made on Open Library come here every 15 minutes or when you choose Sync now.
Right after logging in, and whenever you choose Sync now, books saved only in this
browser are added to Open Library unless Open Library already has that work. The sync
dialog shows how many books are waiting. Changes made while offline or logged out
wait and are sent once you're back online or log in again. Books without an Open
Library work, such as fallback search results, stay only in this app. Open Library
keeps one edition per book, so if you add another edition of a book that's already in
your lists, that extra edition stays only in this app and Open Library is left as it was.
Removing a synced book from Open Library removes it here on the next successful
sync, including copies previously marked as removed. Local-only books and extra
editions stay. Failed or malformed sync responses leave your books untouched;
incomplete shelves keep their existing books and show a warning.

## Cloud Library

### Website accounts (Clerk)

Website accounts are independent of Open Library. Guests keep their books in
this browser; signed-in users sync their library across PC and mobile using Neon.
Open Library is an optional, separate shelf integration.

Create a Clerk application and enable Google, passwords, and email verification
codes in its authentication settings. In the Password tab, turn on
"Sign-up with password" and "Add password to account" so new email users choose
a password and existing users can add one under "Your account" → Security.
Email codes remain available as a fallback. Configure your production domain and Google's production
OAuth credentials in Clerk before deploying. Enable email codes for both sign-up
verification and sign-in, and disable email verification links in both places.
Users can read the code on another device and enter it in the browser where
they started signing in. Verification codes expire; never share them.

Set these environment variables locally in the ignored `.env` file and in the
appropriate Vercel environment **before building**, then restart/redeploy:

```text
PUBLIC_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
CLERK_SECRET_KEY=<Clerk secret key>
STORAGE_URL=<Neon Postgres connection string>
```

Only the publishable key may be public. Never put the secret key or database URL
in client code. Use Clerk development keys locally and production keys for the
production deployment. Without Clerk keys, guest mode and existing Open Library
connections remain available; the account dialog shows disabled sign-in buttons
and explains the required Clerk setup. Clerk configuration alone does not enable
sync: Neon must also be set.

The sidebar's account item (the last item on the mobile bottom bar) shows a grey
dot with "Sign in to sync" or a green dot with "Signed in as …". Signed out, it
opens a sign-in dialog with **Continue with Google**, **Continue with Open
Library**, and an email field that opens Clerk's sign-in (or sign-up) for
password or email-code login. Google sign-in returns through `/sso-callback`.
Signed in, the dialog offers Manage account, Sync now, Open Library and sign
out. It shows device-only
storage, queued changes, sync progress, and successful cloud saves. Its Sync now
button works without Open Library. First sign-in imports guest books without
overwriting existing cloud records or restoring deleted books. Signing out hides
account books and retains the per-account cache/outbox for the next sign-in.
It also disconnects Open Library on this device to prevent the next website
account from inheriting that integration. Disconnecting Open Library alone does
**not** sign out of the website or stop website cloud sync.

### Production Google consent screen

The public privacy policy is at `/privacy`, linked from the library page and
available without sign-in. Before publishing the Google OAuth app, deploy this
page and set the Google Auth Platform Branding homepage to
`https://www.myreadinglist.online` and privacy policy URL to
`https://www.myreadinglist.online/privacy`. Use `myreadinglist.online` as the
authorized domain. Then save Branding and publish from Audience.

Keep the policy's contact address and data practices accurate as the service
changes. Cloud data deletion requests currently require operator handling:
deleting a Clerk account alone does not delete its separate Neon library.

### Existing Open Library cloud libraries

Existing users may continue using their verified Open Library cloud sessions.
To migrate, sign in to the website, connect/re-authenticate with Open Library,
then choose **Link existing Open Library library** in the account dialog.
The server verifies both sessions before claiming that library for the website
account. The merge includes the old account's queued cloud changes on this
browser, preserves existing website books and deletion markers, and keeps a
browser backup when switching accounts. A legacy library can be claimed by only
one website account. After linking, website sign-in is required for cloud access;
an Open Library session alone cannot access the linked website library.
Linking is separate from optional two-way shelf syncing.

### Database configuration

Connect a Neon Postgres database to the Vercel project. The server reads
`STORAGE_URL`, `DATABASE_URL`, or `POSTGRES_URL`; these values must stay private
and must never use a `PUBLIC_` prefix. The required tables are created on the
first cloud access. Database access stays on the server.

For legacy Open Library-only cloud access, log in to Open Library again after
enabling the database. A successful login
creates a separate HTTP-only cloud session; existing username cookies cannot
authorize database access. No Open Library password or access keys are stored
in the database. Logging out revokes the current cloud session.

Cloud storage preserves each selected edition separately, including editions
that Open Library cannot put on its reading log. Existing browser books are
imported without replacing cloud records. Upload failures keep a persistent
per-account outbox, concurrent saves use revision checks, and deletion markers
prevent stale first-time imports from restoring removed books. Account switching
keeps a browser backup of the previous library. Cloud updates arrive on login,
Sync now, returning to the page, reconnecting, and every minute while visible.

For localhost, privately set the database connection in the ignored `.env` file
and restart Astro, then sign in with the same website account (or the same Open
Library account for legacy access). Connecting the
database only to Vercel Production does not configure localhost or Preview.
Localhost and Production must use the same database to share their libraries;
Preview should use a separate database.

## Optional Search Fallback

Press Enter in the search field to search immediately or retry the unchanged
query, keeping its current filters and returning to the first page.

Search uses Open Library first, then Internet Archive's cataloged books when Open Library is unavailable. No API key is required for the Internet Archive fallback.

Open Library search results are cached for 10 minutes. Before serving a cached
result, a live search-service check requests just one record's key, with a
five-second timeout. A failed check never serves the cached results. If
search fails, a warning is shown and results come
only from Internet Archive (saved Open Library matches are not mixed in).
Edition enrichment uses at most three concurrent lookups and caches successful
matches for 10 minutes. If an edition lookup is rate limited or times out, search
availability is checked again before declaring an outage. A working search keeps
its Open Library results and available work covers.
Books without cover data do not, by themselves, indicate an outage.

Fallback results link to their source and do not support the Open Library edition picker. Internet Archive's catalog is narrower than Open Library, so fallback result totals may differ.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

Run `npm run astro -- check` for Astro/TypeScript diagnostics. Account and cloud
sync regressions use Node's built-in runner:

```sh
node --experimental-strip-types --test tests/cloud-library.test.ts tests/website-account.test.ts
```

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).
