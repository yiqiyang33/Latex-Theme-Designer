/** Lines the preview decorates, from first to last. */
export interface LineWindow {
  first: number;
  last: number;
}

/**
 * The lines to decorate for a viewport: the previous ones while the viewport stays `guard` lines
 * clear of their edges, so scrolling within them changes no decoration, else the viewport with
 * `margin` lines on each side.
 */
export function decoratedLines(previous: LineWindow | undefined, top: number, bottom: number, margin: number, guard: number): LineWindow {
  if (previous && (previous.first === 0 || top >= previous.first + guard) && bottom <= previous.last - guard) return previous;
  return { first: Math.max(0, top - margin), last: bottom + margin };
}
