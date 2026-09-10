import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { getProjectBySlug, createProject, createTask, updateTask, getTask, deleteTask, MD_FIELDS } =
  await import('../lib/db')

// Proves the round trip Task 6's `saveField` depends on: updateTask(id, {
// [field]: value }) — the same call saveField makes — persists that one
// field in Appwrite and, for EVERY markdown field (not just one pairing),
// leaves the other four exactly as they were. This is what stops the human
// editing `result` from clobbering the agent's `requirement`, or vice versa.

const project = (await getProjectBySlug('scratch')) ?? (await createProject('Scratch'))

const original = Object.fromEntries(MD_FIELDS.map(f => [f, `original ${f}`])) as Record<string, string>

const task = await createTask(project.id, { title: 'markdown fields probe', ...original })

try {
  for (const field of MD_FIELDS) {
    const newValue = `updated ${field} ${Date.now()}`
    await updateTask(task.id, { [field]: newValue })
    const after = await getTask(task.id)
    assert.ok(after, 'getTask returned null after update')

    assert.equal(after[field], newValue, `${field} did not persist`)
    original[field] = newValue // this field's new value is now the baseline for later iterations

    for (const sibling of MD_FIELDS) {
      if (sibling === field) continue
      assert.equal(after[sibling], original[sibling], `writing ${field} clobbered sibling ${sibling}`)
    }
    console.log(`${field}: persisted, siblings untouched ✓`)
  }
  console.log('\nALL PROBE ASSERTIONS PASSED')
} finally {
  await deleteTask(task.id)
  console.log('cleanup: removed probe task', task.id)
}
