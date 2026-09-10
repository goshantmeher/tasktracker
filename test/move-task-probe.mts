import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { createProject, deleteProject, getProjectBySlug, createTask, updateTask, getTask, deleteTask } =
  await import('../lib/db')
type Status = import('../lib/db').Status

// Proves the same write `moveTask` does — updateTask(id, { status, order })
// — actually persists in Appwrite, not just in the optimistic client state,
// and that moveTask's ownership guard actually refuses a mismatched
// (slug, taskId) pair rather than writing anyway.
//
// `moveTask` itself isn't called directly, here or below: it also calls
// requireUser() (next/headers cookies()) and revalidatePath()
// (next/cache), both of which throw outside a live Next.js request
// context — verified directly: calling currentUser() from a plain script
// throws "`cookies` was called outside a request scope". So this mirrors
// moveTask's actual body instead. Keep this in sync by hand with
// app/p/[slug]/actions.ts's moveTask if that guard ever changes.
async function moveTaskGuarded(slug: string, taskId: string, status: Status, order: number) {
  const project = await getProjectBySlug(slug)
  if (!project) return { refused: true as const, reason: 'no such project' }
  const task = await getTask(taskId)
  if (!task || task.projectId !== project.id) {
    return { refused: true as const, reason: 'task does not belong to that project' }
  }
  await updateTask(taskId, { status, order })
  return { refused: false as const }
}

const projectName = `Probe Board ${Date.now()}`
const otherProjectName = `Probe Board (other) ${Date.now()}`
let project: Awaited<ReturnType<typeof createProject>> | null = null
let otherProject: Awaited<ReturnType<typeof createProject>> | null = null
let task: Awaited<ReturnType<typeof createTask>> | null = null

try {
  project = await createProject(projectName)
  console.log('1. createProject: pass —', project)

  task = await createTask(project.id, { title: 'drag me', status: 'backlog' })
  assert.equal(task.status, 'backlog')
  console.log('2. createTask (backlog): pass —', task)

  // The move: same call shape as moveTask(slug, taskId, status, order),
  // going through the same ownership guard. A fractional order (produced
  // by orderBetween's midpoint arithmetic) exercises the float attribute,
  // not just a round integer.
  const moveResult = await moveTaskGuarded(project.slug, task.id, 'in_progress', 3.5)
  assert.equal(moveResult.refused, false, 'a same-project move was wrongly refused')
  console.log('3. moveTaskGuarded with the correct slug: pass —', moveResult)

  // Re-read from Appwrite (not the update call's own response) to prove the
  // move actually persisted server-side, the thing the board depends on
  // surviving a refresh.
  const reread = await getTask(task.id)
  assert.ok(reread, 'getTask returned null after move')
  assert.equal(reread.status, 'in_progress', 'status did not persist')
  assert.equal(reread.order, 3.5, 'order did not persist')
  console.log('4. re-read after move confirms status+order stuck: pass —', reread)

  // The ownership guard: a second, unrelated project. Calling the guarded
  // move with THIS project's slug but the first project's taskId must be
  // refused, and the task must come back completely untouched.
  otherProject = await createProject(otherProjectName)
  console.log('5. createProject (other, unrelated): pass —', otherProject)

  const wrongProjectResult = await moveTaskGuarded(otherProject.slug, task.id, 'done', 99)
  assert.equal(wrongProjectResult.refused, true, 'a cross-project move was wrongly allowed')
  console.log('6. moveTaskGuarded with the WRONG slug: refused as expected —', wrongProjectResult)

  const untouched = await getTask(task.id)
  assert.ok(untouched, 'getTask returned null after the refused move')
  assert.equal(untouched.status, 'in_progress', 'status changed despite the guard refusing the move')
  assert.equal(untouched.order, 3.5, 'order changed despite the guard refusing the move')
  console.log('7. task left completely untouched by the refused cross-project move: pass —', untouched)

  console.log('\nALL PROBE ASSERTIONS PASSED')
} finally {
  if (task) {
    try {
      await deleteTask(task.id)
      console.log('cleanup: removed probe task', task.id)
    } catch (e) {
      console.error('cleanup FAILED — leftover task may remain:', task.id, e)
    }
  }
  if (project) {
    try {
      await deleteProject(project.id)
      console.log('cleanup: removed probe project', project.id)
    } catch (e) {
      console.error('cleanup FAILED — leftover project may remain:', project.id, e)
    }
  }
  if (otherProject) {
    try {
      await deleteProject(otherProject.id)
      console.log('cleanup: removed probe project (other)', otherProject.id)
    } catch (e) {
      console.error('cleanup FAILED — leftover project may remain:', otherProject.id, e)
    }
  }
}
