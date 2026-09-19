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
  getProjectBySlug, createProject, createTask, deleteTask, listTasks,
  listChecklist, getChecklistItem, addChecklistItems, updateChecklistItem,
  deleteChecklistItem, checklistProgress,
} = await import('../lib/db')
const { LimitError } = await import('../lib/shared')
const { orderBetween } = await import('../lib/order.mjs')
const { callTool } = await import('../app/api/mcp/tools')

/** One tool call, unwrapped: parsed JSON, or the error text. */
async function call(name: string, args: Record<string, unknown>) {
  const res = await callTool(name, args)
  const text = (res.content[0] as { text: string }).text
  if (res.isError) return { error: text, value: undefined }
  return { value: JSON.parse(text), error: undefined }
}

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

  // --- MCP: happy path ------------------------------------------------------
  const made = await call('create_task', {
    project: 'scratch', title: 'probe: checklist over MCP', checklist: ['plan', 'build', 'ship'],
  })
  assert.ok(!made.error, `create_task failed: ${made.error}`)
  created.push(made.value.id)
  ok('create_task reports how many items it created', made.value.checklist === 3)

  const got = await call('get_task', { id: made.value.id })
  ok('get_task returns the checklist in order, as id/text/done only',
    got.value.checklist.map((i: { text: string }) => i.text).join() === 'plan,build,ship'
    && Object.keys(got.value.checklist[0]).join() === 'id,text,done')

  const [plan, build, ship] = got.value.checklist
  const batch = await call('update_checklist', {
    id: made.value.id, check: [plan.id, build.id], remove: [ship.id], add: ['verify'],
  })
  ok('update_checklist applies a batch and answers with counts, not the list',
    batch.value.done === 2 && batch.value.total === 3 && batch.value.added.length === 1
    && !JSON.stringify(batch.value).includes('plan'))

  const undone = await call('update_checklist', { id: made.value.id, uncheck: [plan.id] })
  ok('uncheck clears done', undone.value.done === 1)

  // --- MCP: refusals --------------------------------------------------------
  const stray = await call('update_checklist', { id: made.value.id, check: ['not-an-item'] })
  ok('an id that is not an item of this task is refused', stray.error?.includes('not items of task'))

  const conflicting = await call('update_checklist', { id: made.value.id, check: [plan.id], uncheck: [plan.id] })
  ok('the same id in both check and uncheck is refused',
    conflicting.error?.includes('is in both check and uncheck'))

  const blank = await call('update_checklist', { id: made.value.id, add: ['   '] })
  ok('blank item text is refused', blank.error?.includes('required'))

  const empty = await call('update_checklist', { id: made.value.id })
  ok('a call that changes nothing is refused', empty.error?.includes('nothing to change'))

  const full = await call('update_checklist', { id: made.value.id, add: Array(98).fill('x') })
  ok('going past 100 items is refused before anything is written',
    full.error?.includes('at most 100') && (await listChecklist(made.value.id)).length === 3)

  const badTitle = 'probe: must not exist'
  const badCreate = await call('create_task', {
    project: 'scratch', title: badTitle, checklist: ['ok', 'y'.repeat(513)],
  })
  ok('create_task with a bad item fails before creating the task',
    badCreate.error?.includes('at most 512'))
  const scratchTasks = await listTasks({ projectId: project.id })
  ok('no task was created for the failed call',
    !scratchTasks.some(t => t.title === badTitle))
} finally {
  for (const id of created) {
    try { await deleteTask(id) } catch (e) { console.error('  ! cleanup failed for', id, e) }
  }
}

console.log('\nall checklist checks passed')
