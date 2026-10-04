export const DEFAULT_PAGE_SIZE = 18;
export const MAX_PAGE_SIZE = 60;
const MIN_PAGE_SIZE = 12;
const WIDE_LAYOUT_COLUMNS = 7;
const FALLBACK_MIN_COLUMN_WIDTH = 168;
const FALLBACK_COLUMN_GAP = 20;

/**
 * Wide layouts (7+ columns) show 2 rows; narrower layouts show 3. Very narrow
 * layouts add rows until a page holds at least MIN_PAGE_SIZE books.
 */
export function pageSizeForColumns(columns: number): number {
  const safeColumns = Math.max(1, Math.floor(columns) || 1);
  let rows = safeColumns >= WIDE_LAYOUT_COLUMNS ? 2 : 3;
  while (safeColumns * rows < MIN_PAGE_SIZE) rows++;
  return Math.min(MAX_PAGE_SIZE, safeColumns * rows);
}

export function countGridColumns(grid: HTMLElement): number {
  if (grid.clientWidth > 0) {
    // A rendered grid reports its resolved tracks, e.g. "171px 171px 171px".
    const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
    if (tracks && tracks !== 'none' && !tracks.includes('(')) {
      return Math.max(1, tracks.split(/\s+/).length);
    }
  }

  // Hidden grids (inactive panels) have no layout; estimate from the nearest visible ancestor.
  let ancestor = grid.parentElement;
  while (ancestor && ancestor.clientWidth === 0) ancestor = ancestor.parentElement;
  const width = ancestor?.clientWidth || window.innerWidth;
  return Math.max(
    1,
    Math.floor((width + FALLBACK_COLUMN_GAP) / (FALLBACK_MIN_COLUMN_WIDTH + FALLBACK_COLUMN_GAP)),
  );
}

export function getGridPageSize(grid: HTMLElement): number {
  return pageSizeForColumns(countGridColumns(grid));
}

/** Keeps the first book of the current page visible after the page size changes. */
export function pageForNewSize(currentPage: number, oldPageSize: number, newPageSize: number): number {
  const firstItemIndex = (Math.max(1, currentPage) - 1) * oldPageSize;
  return Math.floor(firstItemIndex / newPageSize) + 1;
}

/** Calls onChange whenever the grid's column count produces a different page size. */
export function observeGridPageSize(
  grid: HTMLElement,
  onChange: (pageSize: number, previousPageSize: number) => void,
): number {
  let pageSize = getGridPageSize(grid);
  if (typeof ResizeObserver === 'undefined') return pageSize;

  new ResizeObserver(() => {
    const nextPageSize = getGridPageSize(grid);
    if (nextPageSize === pageSize) return;
    const previousPageSize = pageSize;
    pageSize = nextPageSize;
    onChange(nextPageSize, previousPageSize);
  }).observe(grid);
  return pageSize;
}
