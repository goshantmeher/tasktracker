import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from '../lib/db'

test('slugify: normal name', () => {
  assert.equal(slugify('Task Tracker'), 'task-tracker')
})

test('slugify: punctuation and spaces collapse to single hyphens', () => {
  assert.equal(slugify('Hello, World! -- Foo_Bar'), 'hello-world-foo-bar')
})

test('slugify: punctuation-only name returns empty string', () => {
  assert.equal(slugify('!!!'), '')
})

test('slugify: leading/trailing separators are stripped', () => {
  assert.equal(slugify('  -- Foo Bar -- '), 'foo-bar')
})

test('slugify: truncates to 64 characters', () => {
  const result = slugify('a'.repeat(100))
  assert.equal(result.length, 64)
  assert.equal(result, 'a'.repeat(64))
})
