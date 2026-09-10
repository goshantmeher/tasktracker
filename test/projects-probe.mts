import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { listProjects, getProjectBySlug, createProject, setArchived, deleteProject, slugify } =
  await import('../lib/db')

type Proj = { id: string; name: string; slug: string; archived: boolean }

function archivedTailPosition(list: Proj[], id: string) {
  const idx = list.findIndex(p => p.id === id)
  const nonArchivedCount = list.filter(p => !p.archived).length
  return { idx, inArchivedTail: idx >= nonArchivedCount }
}

// Global invariant: once an archived project appears, no non-archived
// project may appear after it.
function assertGloballySorted(list: Proj[]) {
  let seenArchived = false
  for (const p of list) {
    if (p.archived) seenArchived = true
    else assert.ok(!seenArchived, `non-archived project "${p.name}" sorted after an archived one`)
  }
}

const name = `Probe Project ${Date.now()}`
let created: Proj | null = null

try {
  // 1. create a project with a unique throwaway name
  created = await createProject(name)
  assert.equal(created.name, name)
  assert.equal(created.slug, slugify(name))
  assert.equal(created.archived, false)
  console.log('1. createProject: pass —', created)

  // 2. list projects and assert the new one is present
  const list1 = await listProjects()
  assert.ok(list1.some(p => p.id === created!.id), 'new project not found in listProjects()')
  console.log('2. listProjects contains new project: pass')

  // 3. getProjectBySlug round-trips
  const found = await getProjectBySlug(created.slug)
  assert.ok(found, 'getProjectBySlug returned null')
  assert.deepEqual(found, created)
  console.log('3. getProjectBySlug round-trips: pass —', found)

  // 4. archive it, re-list, assert it sorts below the non-archived ones
  await setArchived(created.id, true)
  const list2 = await listProjects()
  const p2 = list2.find(p => p.id === created!.id)
  assert.ok(p2?.archived, 'project not archived after setArchived(id, true)')
  assertGloballySorted(list2)
  const pos2 = archivedTailPosition(list2, created.id)
  assert.ok(pos2.inArchivedTail, 'archived project did not sort into the archived tail')
  console.log('4. archived project sorts below non-archived: pass —', pos2)

  // 5. unarchive it, assert it sorts back up
  await setArchived(created.id, false)
  const list3 = await listProjects()
  const p3 = list3.find(p => p.id === created!.id)
  assert.ok(p3 && !p3.archived, 'project still archived after setArchived(id, false)')
  assertGloballySorted(list3)
  const pos3 = archivedTailPosition(list3, created.id)
  assert.ok(!pos3.inArchivedTail, 'unarchived project did not sort back out of the archived tail')
  console.log('5. unarchived project sorts back up: pass —', pos3)

  // 6. delete it, so the probe leaves no residue
  await deleteProject(created.id)
  const deletedId = created.id
  created = null
  const list4 = await listProjects()
  assert.ok(!list4.some(p => p.id === deletedId), 'project still present after deleteProject')
  console.log('6. deleteProject removes it, no residue: pass')

  console.log('\nALL PROBE ASSERTIONS PASSED')
} finally {
  if (created) {
    // Best-effort cleanup on failure so the probe never leaves residue.
    try {
      await deleteProject(created.id)
      console.log('cleanup: removed leftover probe project', created.id)
    } catch (e) {
      console.error('cleanup FAILED — leftover project may remain:', created.id, e)
    }
  }
}
