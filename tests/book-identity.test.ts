import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deduplicateRecommendedBooks, isSameRecommendedBook } from '../src/lib/book-identity.ts';

test('recommendations treat different editions of the same work as already listed', () => {
  assert.equal(
    isSameRecommendedBook(
      { workKey: '/works/OL123W', editionKey: '/books/OL456M' },
      { workKey: '/works/OL123W', editionKey: '/books/OL789M' },
    ),
    true,
  );
});

test('recommendations keep distinct works by the same author eligible', () => {
  assert.equal(
    isSameRecommendedBook(
      { workKey: '/works/OL123W', author: 'Jeff Kinney' },
      { workKey: '/works/OL789W', author: 'Jeff Kinney' },
    ),
    false,
  );
});

test('recommendations match duplicate works with the same title and author', () => {
  assert.equal(
    isSameRecommendedBook(
      { workKey: '/works/OL123W', title: 'Pride and Prejudice', author: 'Jane Austen' },
      { workKey: '/works/OL789W', title: 'Pride and Prejudice', author: 'Jane Austen' },
    ),
    true,
  );
});

test('recommendations deduplicate the same title and author despite differing subtitles', () => {
  assert.equal(
    isSameRecommendedBook(
      {
        workKey: '/works/OL123W',
        title: 'Best of Alcott',
        subtitle: 'Rose in Bloom',
        author: 'Louisa M. Alcott, Harriet Roosevelt Richards',
      },
      {
        workKey: '/works/OL789W',
        title: 'Best of Alcott',
        subtitle: 'Jack and Jill',
        author: 'Louisa M. Alcott, Amy Puetz, Harriet Roosevelt Richards, Jane Dyer',
      },
    ),
    true,
  );
});

test('recommendations keep different Wimpy Kid books by the same author eligible', () => {
  assert.equal(
    isSameRecommendedBook(
      { workKey: '/works/OL123W', title: 'Rodrick Rules', author: 'Jeff Kinney' },
      { workKey: '/works/OL789W', title: 'The Last Straw', author: 'Jeff Kinney' },
    ),
    false,
  );
});

test('recommendation results retain one duplicate title and keep different titles', () => {
  const books = deduplicateRecommendedBooks([
    { title: 'Best of Alcott', subtitle: 'Rose in Bloom', author: 'Louisa M. Alcott' },
    { title: 'Best of Alcott', subtitle: 'Jack and Jill', author: 'Louisa M. Alcott' },
    { title: 'Rodrick Rules', author: 'Jeff Kinney' },
    { title: 'The Last Straw', author: 'Jeff Kinney' },
  ]);

  assert.deepEqual(books.map((book) => book.title), [
    'Best of Alcott',
    'Rodrick Rules',
    'The Last Straw',
  ]);
});