import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderContext } from '../lib/context.mjs'

const task = (over = {}) => ({
  id: 't1', title: 'A task', description: '', requirement: '', prerequisites: '',
  result: '', notes: '', type: 'feature', status: 'todo', priority: 'medium',
  assignee: '', labels: [], order: 0, ...over,
})

const render = (tasks, logByTask = new Map()) =>
  renderContext({ project: { name: 'Demo', slug: 'demo' }, tasks, logByTask })

test('Keep in mind comes before Open tasks', () => {
  const out = render([task({ notes: 'watch out' })])
  assert.ok(out.indexOf('Keep in mind') < out.indexOf('Open tasks'))
})

test('notes from a done task still appear in Keep in mind', () => {
  const out = render([task({ status: 'done', notes: 'the migration is irreversible' })])
  const keep = out.slice(out.indexOf('Keep in mind'), out.indexOf('## Open tasks'))
  assert.ok(keep.includes('the migration is irreversible'))
  assert.ok(keep.includes('A task'), 'note is labelled with its task title')
})

test('tasks without notes contribute nothing to Keep in mind', () => {
  const out = render([task({ title: 'Quiet' })])
  assert.ok(!out.includes('Keep in mind'))
})

test('empty markdown fields are omitted, present ones are labelled', () => {
  const out = render([task({ description: 'the what', requirement: '' })])
  assert.ok(out.includes('the what'))
  assert.ok(!out.includes('Requirement'))
})

test('done tasks are titles plus result, not full bodies', () => {
  const out = render([task({
    status: 'done', title: 'Shipped', description: 'LONG BODY', result: 'it works',
  })])
  const done = out.slice(out.indexOf('## Done'))
  assert.ok(done.includes('Shipped'))
  assert.ok(done.includes('it works'))
  assert.ok(!done.includes('LONG BODY'))
})

test('open tasks are grouped under their status headings', () => {
  const out = render([
    task({ id: 'a', title: 'First', status: 'in_progress' }),
    task({ id: 'b', title: 'Second', status: 'blocked' }),
  ])
  assert.ok(out.indexOf('In Progress') < out.indexOf('Blocked'))
  assert.ok(out.indexOf('First') < out.indexOf('Second'))
})

test('recent work log entries are included for open tasks', () => {
  const log = new Map([['t1', [{ author: 'claude', body: 'tried X', createdAt: '2026-09-10T10:00:00Z' }]]])
  const out = render([task()], log)
  assert.ok(out.includes('tried X'))
  assert.ok(out.includes('claude'))
})

test('an empty board still renders a valid document', () => {
  const out = render([])
  assert.ok(out.startsWith('# Demo'))
  assert.ok(out.includes('No open tasks'))
})
