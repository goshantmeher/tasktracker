/**
 * Position for a card dropped between two neighbours.
 * ponytail: float midpoints, no reindexing on drop. For realistic order
 * values — small integers, the kind bottomOrder() actually produces, e.g.
 * adjacent orders 5 and 6 — 50 consecutive insertions into the same gap is
 * the measured ceiling: the 51st midpoint collides with its lower neighbour
 * and cards start colliding. (Near zero, e.g. starting from (0, 1), floats
 * have far more headroom — over 1000 insertions — but that is not the
 * magnitude real data lives at.) Measured in test/order.test.mjs. Fix then,
 * not now: a renumber pass over the column (0, 1, 2, …) on write.
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
