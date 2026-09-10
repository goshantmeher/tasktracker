import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { getProjectBySlug, createProject, createTask, updateTask, getTask, deleteTask } =
  await import('../lib/db')

const project = (await getProjectBySlug('scratch')) ?? (await createProject('Scratch'))

const t = await createTask(project.id, {
  title: 'partial update probe',
  requirement: 'MUST SURVIVE',
  description: 'ALSO MUST SURVIVE',
})

try {
  await updateTask(t.id, { result: 'written alone' })
  const after = await getTask(t.id)
  assert.ok(after, 'getTask returned null after update')
  assert.equal(after.requirement, 'MUST SURVIVE')
  assert.equal(after.description, 'ALSO MUST SURVIVE')
  assert.equal(after.result, 'written alone')
  console.log('partial update preserves sibling fields ✓')
} finally {
  // Probe must clean up after itself — only the reused Scratch project stays.
  await deleteTask(t.id)
  console.log('cleanup: removed probe task', t.id)
}
