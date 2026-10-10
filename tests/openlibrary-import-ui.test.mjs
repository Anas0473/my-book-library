import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const start = page.indexOf('      importForm.addEventListener("submit"');
const end = page.indexOf('      openLibraryBackButton.addEventListener', start);
assert.ok(start >= 0 && end > start);
const source = ts.transpile(page.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function setup() {
  let submit;
  let complete;
  const context = vm.createContext({
    AbortSignal,
    importForm: { addEventListener: (_, handler) => { submit = handler; } },
    websiteOwner: 'clerk:A', websiteUserId: 'A', websiteAccountGeneration: 1,
    importUsername: { value: 'reader' }, importSubmit: {}, importMessage: {},
    importDialog: { open: true, close() { this.open = false; } },
    localBooks: [{ title: 'Existing', status: 'Read' }],
    fetch: (url, options) => {
      context.request = { url, options };
      return new Promise((resolve) => { complete = resolve; });
    },
    mergeOpenLibraryImport: (existing, incoming) => ({ books: [...existing, ...incoming], added: incoming.length }),
    saved: false,
    saveLocalBooksWithoutPush: () => { context.saved = true; },
    refreshed: false,
    refreshLibraryView: () => { context.refreshed = true; },
  });
  vm.runInContext(source, context);
  return {
    context,
    start: () => submit({ preventDefault() {} }),
    finish: (data = { username: 'reader', books: [{ title: 'Imported', status: 'Read' }], incompleteShelves: [] }) =>
      complete({ ok: true, json: async () => data }),
  };
}

test('one-time import makes only a credential-free public read and updates the website library', async () => {
  const { context, start, finish } = setup();
  const pending = start();
  assert.match(context.request.url, /public=1&username=reader/);
  assert.equal(context.request.options.credentials, 'omit');
  assert.equal(context.request.options.method, undefined);
  finish();
  await pending;
  assert.equal(context.saved, true);
  assert.equal(context.refreshed, true);
  assert.equal(context.localBooks.length, 2);
  assert.match(context.importMessage.textContent, /Imported 1 new book/);
  assert.equal(context.importSubmit.disabled, false);
  assert.equal(context.importDialog.open, false);
});

test('switching website accounts while importing prevents applying the old response', async () => {
  const { context, start, finish } = setup();
  const pending = start();
  context.websiteOwner = 'clerk:B';
  context.websiteUserId = 'B';
  context.websiteAccountGeneration++;
  finish();
  await pending;
  assert.equal(context.saved, false);
  assert.equal(context.localBooks.length, 1);
  assert.match(context.importMessage.textContent, /account changed/);
  assert.equal(context.importDialog.open, true);
});

test('signed-out visitors cannot import into a website account', async () => {
  const { context, start } = setup();
  context.websiteUserId = null;
  await start();
  assert.equal(context.request, undefined);
  assert.equal(context.saved, false);
  assert.match(context.importMessage.textContent, /Sign in/);
});

test('incomplete import explicitly reports partial results', async () => {
  const { context, start, finish } = setup();
  const pending = start();
  finish({ username: 'reader', books: [], incompleteShelves: [{ status: 'Read' }] });
  await pending;
  assert.match(context.importMessage.textContent, /Some shelves were incomplete/);
  assert.equal(context.importDialog.open, true);
});
