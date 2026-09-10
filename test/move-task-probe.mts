import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { createProject, deleteProject, createTask, updateTask, getTask, deleteTask } =
  await import('../lib/db')

// Proves the same write `moveTask` does — updateTask(id, { status, order })
// — actually persists in Appwrite, not just in the optimistic client state.
// `moveTask` itself isn't called directly: it also calls revalidatePath,
// which needs a live Next.js request context this plain script doesn't have.

const projectName = `Probe Board ${Date.now()}`
let project: Awaited<ReturnType<typeof createProject>> | null = null
let task: Awaited<ReturnType<typeof createTask>> | null = null

try {
  project = await createProject(projectName)
  console.log('1. createProject: pass —', project)

  task = await createTask(project.id, { title: 'drag me', status: 'backlog' })
  assert.equal(task.status, 'backlog')
  console.log('2. createTask (backlog): pass —', task)

  // The move: same call shape as moveTask(slug, taskId, status, order).
  // A fractional order (produced by orderBetween's midpoint arithmetic)
  // exercises the float attribute, not just a round integer.
  const moved = await updateTask(task.id, { status: 'in_progress', order: 3.5 })
  assert.equal(moved.status, 'in_progress')
  assert.equal(moved.order, 3.5)
  console.log('3. updateTask(status, order) — immediate return value: pass —', moved)

  // Re-read from Appwrite (not the update call's own response) to prove the
  // move actually persisted server-side, the thing the board depends on
  // surviving a refresh.
  const reread = await getTask(task.id)
  assert.ok(reread, 'getTask returned null after move')
  assert.equal(reread.status, 'in_progress', 'status did not persist')
  assert.equal(reread.order, 3.5, 'order did not persist')
  console.log('4. re-read after move confirms status+order stuck: pass —', reread)

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
}
