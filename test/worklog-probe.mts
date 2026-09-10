import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const {
  createProject, deleteProject, getProjectBySlug, createTask, deleteTask, getTask,
  addLog, listLog, recentLogByTask, deleteLog,
} = await import('../lib/db')
const { resolveAuthor } = await import('../lib/shared')

// Mirrors addLogEntry's ownedTask(slug, taskId) guard by hand, exactly as
// move-task-probe.mts does for moveTask: addLogEntry can't be called
// directly here because currentUser() reaches next/headers' cookies(),
// which throws outside a live Next.js request. Keep this in sync by hand
// with ownedTask in app/p/[slug]/actions.ts if that guard ever changes.
async function ownedTaskGuarded(slug: string, taskId: string) {
  const project = await getProjectBySlug(slug)
  if (!project) throw new Error('no such project')
  const task = await getTask(taskId)
  if (!task) throw new Error('no such task')
  if (task.projectId !== project.id) throw new Error('task does not belong to that project')
  return task
}

// Runs several write calls with bounded concurrency instead of one at a
// time — this probe legitimately needs 100+ real worklog documents to
// cross recentLogByTask's real ceiling (see PHASE 2B), and this is a
// courtesy to the self-hosted Appwrite instance, not a correctness
// requirement (each addLog call is independent).
async function batched<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return out
}

const projectName = `Worklog Probe ${Date.now()}`
let project: Awaited<ReturnType<typeof createProject>> | null = null
const tasks: string[] = []
const logIds: string[] = []

try {
  project = await createProject(projectName)
  console.log('setup: createProject: pass —', project)

  // ---------------------------------------------------------------------
  // PHASE 1 — happy path: entries persist and come back oldest-first.
  // ---------------------------------------------------------------------
  const task1 = await createTask(project.id, { title: 'phase 1: ordering' })
  tasks.push(task1.id)

  const e1 = await addLog(task1.id, 'Alice', 'first entry')
  const e2 = await addLog(task1.id, 'Bob', 'second entry')
  const e3 = await addLog(task1.id, 'Carol', 'third entry')
  logIds.push(e1.id, e2.id, e3.id)

  const list1 = await listLog(task1.id)
  assert.equal(list1.length, 3, 'expected exactly 3 entries')
  assert.deepEqual(list1.map(e => e.id), [e1.id, e2.id, e3.id], 'entries not oldest-first')
  assert.deepEqual(list1.map(e => e.author), ['Alice', 'Bob', 'Carol'])
  assert.deepEqual(list1.map(e => e.body), ['first entry', 'second entry', 'third entry'])
  console.log('1. listLog returns entries oldest-first: pass —', list1.map(e => `${e.author}: ${e.body}`))

  // ---------------------------------------------------------------------
  // PHASE 1B — addLogEntry's cross-project guard (override 4). Trust
  // boundary work, so it stays in phase 1 rather than being deferred.
  // ---------------------------------------------------------------------
  const owned = await ownedTaskGuarded(project.slug, task1.id)
  assert.equal(owned.id, task1.id, 'same-project taskId was wrongly refused')
  console.log('1b-i. ownedTaskGuarded with the correct slug: pass —', owned.id)

  const otherProject = await createProject(`Worklog Probe (other) ${Date.now()}`)
  let crossProjectRefused = false
  try {
    await ownedTaskGuarded(otherProject.slug, task1.id)
  } catch (e) {
    crossProjectRefused = true
    console.log('1b-ii. ownedTaskGuarded with the WRONG slug: refused as expected —',
      e instanceof Error ? e.message : e)
  }
  assert.ok(crossProjectRefused, 'a cross-project taskId was wrongly allowed through the guard')
  try {
    await deleteProject(otherProject.id)
    console.log('cleanup: removed probe project (other)', otherProject.id)
  } catch (e) {
    console.error('cleanup FAILED — leftover project may remain:', otherProject.id, e)
  }

  // ---------------------------------------------------------------------
  // PHASE 2A — recentLogByTask groups correctly across unequal volume,
  // at a scale well inside the window (no starvation possible here: 8
  // total entries vs. a real ceiling in the hundreds). Isolates whether
  // the grouping/capping/re-ordering logic itself is correct, separately
  // from the ceiling question PHASE 2B covers.
  // ---------------------------------------------------------------------
  const taskLow = await createTask(project.id, { title: 'phase 2a: low volume' })
  const taskMed = await createTask(project.id, { title: 'phase 2a: medium volume' })
  const taskHigh = await createTask(project.id, { title: 'phase 2a: high volume' })
  tasks.push(taskLow.id, taskMed.id, taskHigh.id)

  const lowEntries = [await addLog(taskLow.id, 'x', 'low-1')]
  const medEntries = [
    await addLog(taskMed.id, 'x', 'med-1'),
    await addLog(taskMed.id, 'x', 'med-2'),
  ]
  const highEntries = []
  for (let i = 1; i <= 5; i++) highEntries.push(await addLog(taskHigh.id, 'x', `high-${i}`))
  logIds.push(...lowEntries.map(e => e.id), ...medEntries.map(e => e.id), ...highEntries.map(e => e.id))

  const grouped = await recentLogByTask([taskLow.id, taskMed.id, taskHigh.id], 2)
  assert.deepEqual(grouped.get(taskLow.id)?.map(e => e.body), ['low-1'],
    'low-volume task: expected its 1 entry')
  assert.deepEqual(grouped.get(taskMed.id)?.map(e => e.body), ['med-1', 'med-2'],
    'medium-volume task: expected both entries, oldest-first')
  assert.deepEqual(grouped.get(taskHigh.id)?.map(e => e.body), ['high-4', 'high-5'],
    'high-volume task: expected only its 2 newest, oldest-first among them')
  console.log('2. recentLogByTask groups/caps/orders correctly across unequal volume (1, 2, 5 entries): pass —',
    Object.fromEntries([...grouped].map(([k, v]) => [k, v.map(e => e.body)])))

  // ---------------------------------------------------------------------
  // PHASE 2B — the starvation probe (override 1). Reproduces the exact
  // failure mode: one chatty task's recent volume alone fills
  // recentLogByTask's real batched-query window, and several genuinely
  // quiet tasks — each with one real, persisted entry — come back with
  // NOTHING, indistinguishable from a task with no history at all.
  //
  // Real ceiling for this call (4 tasks, default perTask=3):
  //   taskIds.length * perTask + WORKLOG_WINDOW_HEADROOM = 4*3 + 100 = 112
  // The chatty task below writes 120 entries — comfortably more than 112
  // — all created AFTER the three quiet tasks' single entries, so the
  // chatty task's newest 112 alone already fill the entire window before
  // any quiet task's one (older) entry is ever reached.
  // ---------------------------------------------------------------------
  const chatty = await createTask(project.id, { title: 'phase 2b: chatty task' })
  const quietA = await createTask(project.id, { title: 'phase 2b: quiet task A' })
  const quietB = await createTask(project.id, { title: 'phase 2b: quiet task B' })
  const quietC = await createTask(project.id, { title: 'phase 2b: quiet task C' })
  tasks.push(chatty.id, quietA.id, quietB.id, quietC.id)

  const quietEntries = await batched(
    [quietA, quietB, quietC], 3,
    t => addLog(t.id, 'x', `quiet entry for ${t.title}`),
  )
  logIds.push(...quietEntries.map(e => e.id))

  const CHATTY_COUNT = 120
  const chattyEntries = await batched(
    Array.from({ length: CHATTY_COUNT }, (_, i) => i),
    10,
    i => addLog(chatty.id, 'x', `chatty entry ${i}`),
  )
  logIds.push(...chattyEntries.map(e => e.id))
  console.log(`3. setup: wrote 1 entry each to 3 quiet tasks, then ${CHATTY_COUNT} entries to 1 chatty task: pass`)

  const starved = await recentLogByTask([chatty.id, quietA.id, quietB.id, quietC.id])
  const chattyResult = starved.get(chatty.id) ?? []
  assert.equal(chattyResult.length, 3, 'chatty task should still be correctly capped at perTask=3')

  const quietResults = {
    A: starved.has(quietA.id), B: starved.has(quietB.id), C: starved.has(quietC.id),
  }
  console.log('4. recentLogByTask([chatty, quietA, quietB, quietC]) result — chatty entries:',
    chattyResult.length, 'quiet tasks present in result:', quietResults)

  if (!quietResults.A && !quietResults.B && !quietResults.C) {
    console.log('STARVATION CONFIRMED: all 3 quiet tasks, each with one real persisted worklog entry, ' +
      `came back with ZERO entries from recentLogByTask — crowded out entirely by the chatty task's ` +
      `${CHATTY_COUNT} newer entries filling the batched query's real window (limit 112). A caller ` +
      `(e.g. /api/context) cannot distinguish this from those tasks genuinely having no history.`)
  } else {
    console.log('starvation did NOT reproduce at these volumes — quiet tasks:', quietResults)
  }

  // ---------------------------------------------------------------------
  // PHASE 2C — author fallback (override 3). Exercises the exact
  // function addLogEntry calls, resolveAuthor(user.name, user.email),
  // with the two shapes a real Appwrite user record can have: a name
  // that's the empty string (falls back to email), and — the fully
  // degenerate case — both empty (falls back to the fixed literal).
  // ---------------------------------------------------------------------
  const taskAuthor = await createTask(project.id, { title: 'phase 2c: author fallback' })
  tasks.push(taskAuthor.id)

  const namelessAuthor = resolveAuthor('', 'nameless@example.com')
  const eNameless = await addLog(taskAuthor.id, namelessAuthor, 'entry from a nameless user')
  const blankAuthor = resolveAuthor('', '')
  const eBlank = await addLog(taskAuthor.id, blankAuthor, 'entry from a user with neither name nor email')
  logIds.push(eNameless.id, eBlank.id)

  const authorLog = await listLog(taskAuthor.id)
  assert.equal(authorLog[0].author, 'nameless@example.com', 'expected email fallback, got blank/other')
  assert.notEqual(authorLog[0].author.trim(), '', 'author must never be blank')
  assert.equal(authorLog[1].author, 'Unknown', 'expected fixed-literal fallback, got blank/other')
  assert.notEqual(authorLog[1].author.trim(), '', 'author must never be blank')
  console.log('5. author fallback proven end-to-end through addLog/listLog: pass —',
    authorLog.map(e => e.author))

  console.log('\nALL PROBE ASSERTIONS PASSED')
} finally {
  if (logIds.length) {
    const results = await batched(logIds, 10, async id => {
      try { await deleteLog(id); return true } catch (e) { console.error('cleanup FAILED for log', id, e); return false }
    })
    console.log(`cleanup: removed ${results.filter(Boolean).length}/${logIds.length} worklog entries`)
  }
  if (tasks.length) {
    const results = await batched(tasks, 10, async id => {
      try { await deleteTask(id); return true } catch (e) { console.error('cleanup FAILED for task', id, e); return false }
    })
    console.log(`cleanup: removed ${results.filter(Boolean).length}/${tasks.length} tasks`)
  }
  if (project) {
    try {
      await deleteProject(project.id)
      console.log('cleanup: removed probe project', project.id)
    } catch (e) {
      console.error('cleanup FAILED — leftover project may remain:', project.id, e)
    }
  }
}
