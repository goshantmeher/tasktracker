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

/**
 * Drag-and-drop order arithmetic, pulled out of the client drag handler so
 * it can be unit-tested. `column` is the target column sorted by `order`
 * (it may or may not still contain the dragged card — this filters it out
 * either way). `beforeId` is the card the drop landed on, or null to append
 * at the bottom. `draggedId` is the card being moved.
 *
 * A previous version of this logic lived inline in the drop handler and
 * indexed `column[idx]` when `idx` was -1 (beforeId not found after
 * filtering out the dragged card) — a TypeError. That happens whenever
 * `beforeId` isn't in the filtered column, including the classic case of
 * dropping a card onto itself. Both are treated the same way here: fall
 * back to appending at the bottom instead of throwing. Callers should still
 * short-circuit a real self-drop before calling this (see board.tsx) so it
 * reads as a true no-op rather than a jump to the bottom.
 *
 * @param {{id: string, order: number}[]} column
 * @param {string|null} beforeId
 * @param {string} draggedId
 * @returns {number}
 */
export function nextOrder(column, beforeId, draggedId) {
  const col = column.filter(t => t.id !== draggedId)
  const found = beforeId ? col.findIndex(t => t.id === beforeId) : col.length
  const idx = found === -1 ? col.length : found
  return orderBetween(
    idx > 0 ? col[idx - 1].order : null,
    idx < col.length ? col[idx].order : null,
  )
}
