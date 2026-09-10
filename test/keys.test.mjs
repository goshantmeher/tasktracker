import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKey, hashKey } from '../lib/keys.mjs'

test('generateKey returns 64 hex chars and never repeats', () => {
  const a = generateKey()
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, generateKey())
})

test('hashKey is deterministic, 64 hex chars, and not the key itself', () => {
  const key = generateKey()
  assert.equal(hashKey(key), hashKey(key))
  assert.match(hashKey(key), /^[0-9a-f]{64}$/)
  assert.notEqual(hashKey(key), key)
})

test('different keys hash differently', () => {
  assert.notEqual(hashKey('a'), hashKey('b'))
})
