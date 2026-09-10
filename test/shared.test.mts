import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowed, STATUSES, resolveAuthor } from '../lib/shared'

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

// This is the exact expression app/p/[slug]/actions.ts's addLogEntry calls
// (resolveAuthor(user.name, user.email)) — the work log's author must
// never render blank, because an entry can never be edited once written.

test('resolveAuthor: a real name is used as-is', () => {
  assert.equal(resolveAuthor('Alice', 'alice@example.com'), 'Alice')
})

test('resolveAuthor: an empty name falls back to email', () => {
  assert.equal(resolveAuthor('', 'nameless@example.com'), 'nameless@example.com')
})

test('resolveAuthor: empty name AND empty email falls back to the fixed literal', () => {
  assert.equal(resolveAuthor('', ''), 'Unknown')
})
