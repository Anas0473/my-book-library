import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageForNewSize, pageSizeForColumns } from '../src/lib/responsive-page-size';

test('wide layouts show two rows and narrower layouts show three', () => {
  assert.equal(pageSizeForColumns(9), 18);
  assert.equal(pageSizeForColumns(7), 14);
  assert.equal(pageSizeForColumns(6), 18);
  assert.equal(pageSizeForColumns(5), 15);
  assert.equal(pageSizeForColumns(4), 12);
});

test('narrow layouts keep at least twelve books per page in full rows', () => {
  assert.equal(pageSizeForColumns(1), 12);
  assert.equal(pageSizeForColumns(2), 12);
  assert.equal(pageSizeForColumns(3), 12);
  assert.equal(pageSizeForColumns(0), 12);
});

test('very wide layouts are capped', () => {
  assert.equal(pageSizeForColumns(40), 60);
});

test('resizing keeps the first visible book on the new page', () => {
  assert.equal(pageForNewSize(1, 18, 15), 1);
  assert.equal(pageForNewSize(3, 18, 15), 3); // book 37 -> page 3 (31-45)
  assert.equal(pageForNewSize(4, 15, 18), 3); // book 46 -> page 3 (37-54)
});
