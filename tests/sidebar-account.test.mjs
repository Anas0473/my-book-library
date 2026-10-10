import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const start = page.indexOf('      function updateAccountButton()');
const end = page.indexOf('      function openAccountDialog()', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const image = {
    hidden: true,
    getAttribute() { return this.src ?? null; },
    removeAttribute() { delete this.src; },
  };
  const element = () => ({ dataset: {}, classList: { toggle() {} } });
  const context = vm.createContext({
    websiteUserId: 'user-A', websiteUserName: 'Alice', websiteUserImage: 'https://example.com/alice.jpg',
    websiteOwner: 'clerk:user-A', cloudReauthenticationRequired: false,
    getOpenLibraryPushUser: () => null,
    accountButton: element(), mobileAccountButton: element(), accountDialog: element(),
    accountButtonLabel: {}, accountButtonStatus: {}, accountSummary: {},
    accountAvatarImage: image, accountAvatarFallback: { hidden: false },
  });
  vm.runInContext(page.slice(start, end), context);
  return context;
}

test('signed-in account shows its name and profile picture', () => {
  const context = setup();
  context.updateAccountButton();
  assert.equal(context.accountButtonLabel.textContent, 'Alice');
  assert.equal(context.accountButtonStatus.textContent, 'Manage account');
  assert.equal(context.accountAvatarImage.src, 'https://example.com/alice.jpg');
  assert.equal(context.accountAvatarImage.hidden, false);
  assert.equal(context.accountAvatarFallback.hidden, true);
});

test('signing out clears the previous profile picture', () => {
  const context = setup();
  context.updateAccountButton();
  context.websiteUserId = null;
  context.updateAccountButton();
  assert.equal(context.accountAvatarImage.src, undefined);
  assert.equal(context.accountAvatarImage.hidden, true);
  assert.equal(context.accountAvatarFallback.hidden, false);
});

test('accounts without a photo and Open Library-only accounts use the fallback', () => {
  const context = setup();
  context.websiteUserImage = null;
  context.updateAccountButton();
  assert.equal(context.accountAvatarFallback.hidden, false);
  context.websiteUserId = null;
  context.getOpenLibraryPushUser = () => 'reader';
  context.updateAccountButton();
  assert.equal(context.accountButtonLabel.textContent, 'Open Library connected');
  assert.equal(context.accountAvatarImage.hidden, true);
});
