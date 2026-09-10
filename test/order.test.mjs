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

test('repeated insertion into the same gap keeps producing distinct values', () => {
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = orderBetween(lo, hi)
    assert.ok(mid > lo && mid < hi, `iteration ${i}: ${mid} not strictly between ${lo} and ${hi}`)
    hi = mid
  }
})
