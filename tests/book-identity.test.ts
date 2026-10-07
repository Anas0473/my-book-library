import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameOpenLibraryWork } from '../src/lib/book-identity.ts';

test('recommendations treat different editions of the same work as already listed', () => {
  assert.equal(
    isSameOpenLibraryWork(
      { workKey: '/works/OL123W', editionKey: '/books/OL456M' },
      { workKey: '/works/OL123W', editionKey: '/books/OL789M' },
    ),
    true,
  );
});

test('recommendations keep distinct works by the same author eligible', () => {
  assert.equal(
    isSameOpenLibraryWork(
      { workKey: '/works/OL123W', author: 'Jeff Kinney' },
      { workKey: '/works/OL789W', author: 'Jeff Kinney' },
    ),
    false,
  );
});