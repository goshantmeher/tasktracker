import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowed, STATUSES } from '../lib/shared'

// This is the status-whitelist check behind app/p/[slug]/actions.ts's
// quickAddTask (and, per Task 6's brief, saveScalars): the guard against a
// crafted POST sending a `status` that isn't one of the five real ones.

test('isAllowed: a real status passes', () => {
  assert.equal(isAllowed('todo', STATUSES), true)
  assert.equal(isAllowed('backlog', STATUSES), true)
  assert.equal(isAllowed('done', STATUSES), true)
})

test('isAllowed: a forged/bogus status is rejected', () => {
  assert.equal(isAllowed('deleted', STATUSES), false)
  assert.equal(isAllowed('', STATUSES), false)
  assert.equal(isAllowed('TODO', STATUSES), false) // case-sensitive, no normalization
})

test('isAllowed: works against any allowed-values list, not just STATUSES', () => {
  const allowed = ['a', 'b', 'c'] as const
  assert.equal(isAllowed('b', allowed), true)
  assert.equal(isAllowed('z', allowed), false)
})
