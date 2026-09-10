/**
 * Position for a card dropped between two neighbours.
 * ponytail: float midpoints, no reindexing on drop. After roughly 50
 * consecutive insertions into the same gap the midpoint stops being strictly
 * between its neighbours and cards start colliding. Fix then, not now: a
 * renumber pass over the column (0, 1, 2, …) on write.
 *
 * @param {number|null} before order of the card above, null if dropped at top
 * @param {number|null} after  order of the card below, null if dropped at bottom
 * @returns {number}
 */
export function orderBetween(before, after) {
  if (before === null && after === null) return 0
  if (before === null) return after - 1
  if (after === null) return before + 1
  return (before + after) / 2
}
