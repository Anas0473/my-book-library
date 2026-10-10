export function isBookRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function createBookRating(
  rating: unknown,
  onChange: (rating: number | null) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'book-rating';
  const label = document.createElement('span');
  label.className = 'book-rating-label';
  label.textContent = 'Your rating';
  container.appendChild(label);
  const stars = document.createElement('div');
  stars.className = 'book-rating-stars';
  stars.setAttribute('role', 'group');
  stars.setAttribute('aria-label', 'Your book rating');
  let current = isBookRating(rating) ? rating : null;
  const buttons: HTMLButtonElement[] = [];
  const summary = document.createElement('span');
  summary.className = 'book-rating-summary';
  summary.setAttribute('role', 'status');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'book-rating-clear';
  clear.textContent = 'Clear rating';
  function change(value: number | null) {
    try {
      onChange(value);
      current = value;
      refresh();
    } catch (error) {
      console.error('Could not save book rating', error);
      summary.textContent = 'Could not save your rating. Reopen the book details and try again.';
    }
  }
  function refresh() {
    buttons.forEach((button, index) => {
      button.textContent = index < (current || 0) ? '\u2605' : '\u2606';
      button.setAttribute('aria-pressed', String(current === index + 1));
    });
    summary.textContent = current ? `${current} out of 5 stars` : 'Not rated';
    clear.hidden = current === null;
  }
  for (let value = 1; value <= 5; value++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Rate ${value} ${value === 1 ? 'star' : 'stars'}`);
    button.addEventListener('click', () => {
      change(value);
    });
    buttons.push(button);
    stars.appendChild(button);
  }
  clear.addEventListener('click', () => {
    change(null);
  });
  container.append(stars, summary, clear);
  refresh();
  return container;
}
