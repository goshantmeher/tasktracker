// The checklist, run against live Appwrite: lib/db.ts first, then (Task 2)
// the MCP tools through the real dispatcher.
//
// Run with: node --import tsx test/checklist-probe.mts
//
// Writes only to the `scratch` project and deletes everything it created.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const {
  getProjectBySlug, createProject, createTask, deleteTask,
  listChecklist, getChecklistItem, addChecklistItems, updateChecklistItem,
  deleteChecklistItem, checklistProgress,
} = await import('../lib/db')
const { LimitError } = await import('../lib/shared')
const { orderBetween } = await import('../lib/order.mjs')

const project = (await getProjectBySlug('scratch')) ?? (await createProject('Scratch'))
assert.equal(project.slug, 'scratch', 'this probe writes to scratch and nowhere else')

const ok = (label: string, cond: unknown) => {
  assert.ok(cond, label)
  console.log('  ✓', label)
}
const texts = async (taskId: string) => (await listChecklist(taskId)).map(i => i.text).join()

const created: string[] = []

try {
  // --- db: happy path -------------------------------------------------------
  const task = await createTask(project.id, { title: 'probe: checklist' })
  created.push(task.id)

  const [a, b, c] = await addChecklistItems(task, ['one', 'two', 'three'])
  ok('items come back in the order they were added', (await texts(task.id)) === 'one,two,three')
  ok('a new item starts not done', !a.done && a.taskId === task.id)

  await updateChecklistItem(b.id, { done: true })
  const after = await listChecklist(task.id)
  ok('ticking writes only that item',
    after.find(i => i.id === b.id)!.done && !after.find(i => i.id === a.id)!.done)

  ok('progress counts done and total for the project',
    JSON.stringify((await checklistProgress(project.id))[task.id]) === '{"done":1,"total":3}')

  await updateChecklistItem(c.id, { order: orderBetween(null, a.order) })
  ok('an order write moves an item', (await texts(task.id)) === 'three,one,two')

  await updateChecklistItem(a.id, { text: 'one, renamed' })
  ok('a text write renames an item', (await texts(task.id)) === 'three,one, renamed,two')

  await deleteChecklistItem(a.id)
  ok('deleting an item removes only that item', (await texts(task.id)) === 'three,two')

  // --- db: limits and cleanup -----------------------------------------------
  await assert.rejects(() => addChecklistItems(task, Array(99).fill('x')), LimitError)
  ok('the 101st item is refused and none of the batch is written', (await listChecklist(task.id)).length === 2)

  const ids = (await listChecklist(task.id)).map(i => i.id)
  await deleteTask(task.id)
  created.splice(created.indexOf(task.id), 1)
  ok('deleting a task deletes its items',
    (await Promise.all(ids.map(getChecklistItem))).every(i => i === null))
} finally {
  for (const id of created) {
    try { await deleteTask(id) } catch (e) { console.error('  ! cleanup failed for', id, e) }
  }
}

console.log('\nall checklist checks passed')
