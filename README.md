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

In Book details or an edition preview, click the cover (or focus it and press Enter)
to open the full-size cover viewer. Click the viewer or press Escape to return
to the details.

Search results use the same Book details and edition previews as My Lists.
Click a result's cover, title, or non-interactive area to view its details.
Browse editions opens the edition list; selecting an edition shows its details
and lets you add that specific edition to a list without changing the search result.

When syncing from Open Library, a logged edition without a cover is shown as the
work's newest edition that has one. Editions you pick in this app are kept as chosen.
Sync reads edition records in batches from Open Library's Books API rather than
its search index, so cover changes appear on the next successful sync even when
the index is out of date. Failed edition lookups fail the sync without replacing
your saved books.

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

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).
