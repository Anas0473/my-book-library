import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('export ', '');
  const context = vm.createContext({ ...globals });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context);
  return context;
}

test('cloud ratings validate, survive sync and can be cleared', () => {
  const cloud = load('../src/lib/cloud-library.ts');
  const change = (rating) => [{ id: 'edition:OL1M', book: {
    title: 'Test', status: 'Read', editionKey: '/books/OL1M', rating,
  } }];
  for (const rating of [1, 2, 3, 4, 5]) {
    const validated = cloud.validateCloudChanges(change(rating));
    assert.equal(validated[0].book.rating, rating);
    const stored = cloud.applyCloudChanges({}, validated);
    assert.equal(cloud.activeCloudBooks(stored)[0].rating, rating);
    const cleared = cloud.validateCloudChanges(change(undefined));
    assert.equal(cloud.applyCloudChanges(stored, cleared)['edition:OL1M'].rating, undefined);
  }
  for (const rating of [0, 6, 2.5, '5', NaN, Infinity]) {
    assert.throws(() => cloud.validateCloudChanges(change(rating)), /rating/);
  }
});

test('rating controls set, change and clear ratings without saving on open', () => {
  class Element {
    children = [];
    attributes = {};
    listeners = {};
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.listeners[key] = callback; }
    click() { this.listeners.click(); }
  }
  const ui = load('../src/lib/book-rating.ts', {
    document: { createElement: () => new Element() }, console,
  });
  const changes = [];
  const control = ui.createBookRating(undefined, (value) => changes.push(value));
  const [, stars, summary, clear] = control.children;
  assert.equal(changes.length, 0);
  assert.equal(summary.textContent, 'Not rated');
  assert.equal(clear.hidden, true);
  stars.children[3].click();
  assert.equal(summary.textContent, '4 out of 5 stars');
  assert.equal(stars.children[3].attributes['aria-pressed'], 'true');
  stars.children[1].click();
  clear.click();
  assert.deepEqual(changes, [4, 2, null]);
  assert.equal(summary.textContent, 'Not rated');
});

test('failed saves are reported and do not display a successful new rating', () => {
  class Element {
    children = [];
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    setAttribute() {}
    addEventListener(_, callback) { this.click = callback; }
  }
  const ui = load('../src/lib/book-rating.ts', {
    document: { createElement: () => new Element() }, console: { error() {} },
  });
  const control = ui.createBookRating(2, () => { throw new Error('Storage unavailable'); });
  control.children[1].children[4].click();
  assert.match(control.children[2].textContent, /Could not save/);
});
