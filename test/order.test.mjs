import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderBetween } from '../lib/order.mjs'

test('into an empty column', () => {
  assert.equal(orderBetween(null, null), 0)
})

test('above the first card', () => {
  assert.equal(orderBetween(null, 5), 4)
})

test('below the last card', () => {
  assert.equal(orderBetween(5, null), 6)
})

test('between two cards takes the midpoint', () => {
  assert.equal(orderBetween(2, 4), 3)
  assert.equal(orderBetween(0, 1), 0.5)
})

test('repeated insertion into the same gap keeps producing distinct values, at realistic order magnitudes', () => {
  // Realistic orders are small integers from bottomOrder() (0, 1, 2, …), not
  // (0, 1) — the single best case for float precision, which survives over
  // 1000 insertions and proves nothing about the documented ceiling. Start
  // from adjacent small integers instead, per lib/order.mjs's doc comment.
  // Measured (see below): the 51st insertion into (5, 6) collides; 50 is the
  // real ceiling at this magnitude, not a guess.
  let lo = 5, hi = 6
  for (let i = 0; i < 50; i++) {
    const mid = orderBetween(lo, hi)
    assert.ok(mid > lo && mid < hi, `iteration ${i}: ${mid} not strictly between ${lo} and ${hi}`)
    hi = mid
  }
})

test('...and that ceiling is real: the 51st insertion into the same gap collides', () => {
  let lo = 5, hi = 6
  for (let i = 0; i < 50; i++) hi = orderBetween(lo, hi)
  const mid = orderBetween(lo, hi)
  assert.ok(!(mid > lo && mid < hi),
    `expected the 51st insertion to collide with its neighbour, got ${mid} still strictly between ${lo} and ${hi}`)
})
