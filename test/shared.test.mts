import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowed, STATUSES, resolveAuthor, checklistText, LimitError, CHECKLIST_TEXT_MAX } from '../lib/shared'

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

// The one validator every door (MCP, REST, server actions) runs item text
// through, so they cannot disagree on what a valid item is.
test('checklistText: trims and accepts ordinary text', () => {
  assert.equal(checklistText('  write the test  '), 'write the test')
})

test('checklistText: refuses blank, non-string and over-length text', () => {
  assert.throws(() => checklistText('   '), LimitError)
  assert.throws(() => checklistText(42), LimitError)
  assert.throws(() => checklistText(undefined), LimitError)
  assert.throws(() => checklistText('x'.repeat(CHECKLIST_TEXT_MAX + 1)), LimitError)
  assert.equal(checklistText('x'.repeat(CHECKLIST_TEXT_MAX)).length, CHECKLIST_TEXT_MAX)
})
