import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextOrder } from '../lib/order.mjs'

test('drop into an empty column', () => {
  assert.equal(nextOrder([], null, 'a'), 0)
})

test('drop above the first card', () => {
  const col = [{ id: 'b', order: 5 }]
  assert.equal(nextOrder(col, 'b', 'a'), 4)
})

test('drop at the bottom', () => {
  const col = [{ id: 'b', order: 5 }]
  assert.equal(nextOrder(col, null, 'a'), 6)
})

test('drop between two cards', () => {
  const col = [{ id: 'b', order: 2 }, { id: 'c', order: 4 }]
  assert.equal(nextOrder(col, 'c', 'a'), 3)
})

test('drop onto itself does not crash and falls back to append-at-bottom', () => {
  // Reproduces the brief's bug: col is built with the dragged card filtered
  // out, so beforeId === draggedId can never be found in it. Must not throw.
  const col = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }]
  assert.doesNotThrow(() => nextOrder(col, 'a', 'a'))
  assert.equal(nextOrder(col, 'a', 'a'), 4)
})

test('beforeId not present in the column falls back to append-at-bottom instead of throwing', () => {
  const col = [{ id: 'x', order: 1 }, { id: 'y', order: 2 }]
  assert.doesNotThrow(() => nextOrder(col, 'does-not-exist', 'a'))
  assert.equal(nextOrder(col, 'does-not-exist', 'a'), 3)
})

test('a self-drop that empties the column entirely falls back to 0', () => {
  const col = [{ id: 'a', order: 1 }]
  assert.doesNotThrow(() => nextOrder(col, 'a', 'a'))
  assert.equal(nextOrder(col, 'a', 'a'), 0)
})
