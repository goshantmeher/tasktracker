// What the "make the MCP server cheap enough to use often" changes claim, run
// against live Appwrite through the real tool dispatcher (callTool), because
// every one of them is a claim about what a handler + lib/db.ts do together.
//
// Run with: node --import tsx test/mcp-cost-probe.mts
//
// Writes only to the `scratch` project and deletes everything it created.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { getProjectBySlug, createProject, getTask, listLog, deleteTask, deleteLog } =
  await import('../lib/db')
const { callTool } = await import('../app/api/mcp/tools')

// Every call below names the project by slug, so this only has to exist.
if (!(await getProjectBySlug('scratch'))) await createProject('Scratch')

/** One tool call, unwrapped: parsed JSON, raw markdown, or the error text. */
async function call(name: string, args: Record<string, unknown>) {
  const res = await callTool(name, args)
  const text = (res.content[0] as { text: string }).text
  if (res.isError) return { error: text }
  try { return { value: JSON.parse(text) } } catch { return { value: text } }
}

const ok = (label: string, cond: unknown) => {
  assert.ok(cond, label)
  console.log('  ✓', label)
}

const created: string[] = []
const make = async (args: Record<string, unknown>) => {
  const { value, error } = await call('create_task', { project: 'scratch', ...args })
  assert.ok(!error, `create_task failed: ${error}`)
  created.push(value.id)
  return value
}

try {
  // --- change 2: writes stop echoing what was sent ---------------------------
  const a = await make({ title: 'probe: one call finishes a task', description: 'SENT BODY' })
  ok('create_task answers with the id, not the body', a.ok === true && a.id && !JSON.stringify(a).includes('SENT BODY'))

  // --- change 6b: every task carries a label ---------------------------------
  ok('a task created with no labels is defaulted to untriaged',
    JSON.stringify(a.labels) === JSON.stringify(['untriaged']))

  // --- change 1: one call finishes a task ------------------------------------
  const done = await call('update_task', {
    id: a.id, status: 'done', result: 'it worked', log: 'tried X, then Y — Y worked',
  })
  ok('update_task takes status, result and log together', !done.error && done.value.ok === true)
  ok('the response names the fields written, not their contents',
    JSON.stringify(done.value.updated) === JSON.stringify(['result', 'status'])
    && !JSON.stringify(done.value).includes('it worked'))

  const after = await getTask(a.id)
  ok('the fields landed', after!.status === 'done' && after!.result === 'it worked')
  ok('the description it never mentioned is untouched', after!.description === 'SENT BODY')

  const log = await listLog(a.id)
  ok('the log entry landed, attributed like add_log', log.length === 1
    && log[0].author === 'claude' && log[0].body === 'tried X, then Y — Y worked')

  // --- change 1: the partial contract survives a log-only call ----------------
  const logOnly = await call('update_task', { id: a.id, log: 'a second entry' })
  ok('update_task with only a log appends and writes no field',
    !logOnly.error && logOnly.value.logged === true && logOnly.value.updated.length === 0)
  const after2 = await getTask(a.id)
  ok('a log-only call left every field alone',
    after2!.result === 'it worked' && after2!.description === 'SENT BODY' && after2!.status === 'done')
  ok('both entries are in the log, oldest first', (await listLog(a.id)).length === 2)

  const empty = await call('update_task', { id: a.id })
  ok('a call with neither fields nor a log is still an error', !!empty.error)

  // --- change 2: add_log does not read a long entry back ----------------------
  const appended = await call('add_log', { id: a.id, body: 'LONG ENTRY BODY' })
  ok('add_log answers with ids, not the entry',
    !appended.error && appended.value.ok === true && !JSON.stringify(appended.value).includes('LONG ENTRY BODY'))

  // --- change 6a: several labels, combined -----------------------------------
  const b = await make({ title: 'probe: store+money', labels: ['probe', 'store', 'money'] })
  const c = await make({ title: 'probe: store only', labels: ['probe', 'store'] })

  const all = await call('list_tasks', {
    project: 'scratch', labels: ['store', 'money'], match: 'all', fields: ['id'],
  })
  ok('match "all" returns only tasks carrying every label',
    JSON.stringify(all.value) === JSON.stringify([{ id: b.id }]))

  const any = await call('list_tasks', {
    project: 'scratch', labels: ['store', 'untriaged'], match: 'any', fields: ['id'],
  })
  ok('match "any" returns tasks carrying either',
    any.value.length === 3 && any.value.every((t: { id: string }) => created.includes(t.id)))

  const single = await call('list_tasks', { project: 'scratch', label: 'store', fields: ['id'] })
  ok('the original single-label parameter still behaves as it did',
    single.value.length === 2 && !single.value.some((t: { id: string }) => t.id === a.id))

  // --- change 3: an index instead of the contents ----------------------------
  const index = await call('list_tasks', { project: 'scratch', fields: ['id', 'title', 'status'] })
  ok('fields returns only those keys',
    Object.keys(index.value[0]).join() === 'id,title,status'
    && !JSON.stringify(index.value).includes('SENT BODY'))
  const typo = await call('list_tasks', { project: 'scratch', fields: ['titel'] })
  ok('a misspelled field is an error that names the real ones',
    typo.error?.includes('titel') && typo.error?.includes('title'))

  const board = await call('get_board', { project: 'scratch' })
  const md = board.value as string
  ok('get_board is an index: one line per open task, no bodies',
    md.includes('## Open tasks') && md.includes(b.id) && !md.includes('SENT BODY'))
  ok('get_board counts finished work instead of printing it',
    /## Done\n\n\d+ finished task/.test(md))

  // --- change 4: the short id from a board URL --------------------------------
  const short = await call('get_task', { id: a.id.slice(0, 8) })
  ok('a unique id prefix resolves', !short.error && short.value.id === a.id)
  // `a` was created a few seconds before b and c, so its 8-char prefix is
  // unique where theirs (minted back to back) share one — which is exactly
  // what the ambiguity check below needs.
  const shortWrite = await call('update_task', { id: a.id.slice(0, 8), priority: 'high' })
  ok('a prefix works for a write too', !shortWrite.error && shortWrite.value.id === a.id)
  ok('the write landed on the resolved task', (await getTask(a.id))!.priority === 'high')

  let shared = ''
  for (let i = 0; i < b.id.length && b.id[i] === c.id[i]; i++) shared += b.id[i]
  const ambiguous = await call('get_task', { id: shared })
  ok('an ambiguous prefix lists the candidates instead of failing blankly',
    ambiguous.error?.includes('ambiguous') && ambiguous.error.includes(b.id) && ambiguous.error.includes(c.id))

  const missing = await call('get_task', { id: 'ffffffffffff' })
  ok('a prefix matching nothing is still a plain not-found', missing.error?.startsWith('no such task'))

  console.log('\nall MCP cost checks passed')
} finally {
  for (const id of created) {
    for (const entry of await listLog(id, 500)) await deleteLog(entry.id)
    await deleteTask(id)
  }
  console.log('cleanup: removed', created.length, 'probe tasks and their log entries')
}
