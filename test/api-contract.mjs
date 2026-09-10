import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const KEY = process.env.TEST_API_KEY
assert.ok(KEY, 'TEST_API_KEY must be set in .env.local (mint one at /settings/keys)')

// Looked up in-process (not over HTTP — there is no REST route for this) so
// the work-log author checks below can assert against the real label
// instead of just "some non-empty string".
const { findKeyByHash } = await import('../lib/db.ts')
const { hashKey } = await import('../lib/keys.mjs')
const keyRecord = await findKeyByHash(hashKey(KEY))
assert.ok(keyRecord, 'TEST_API_KEY does not resolve to a real key record')

const api = async (path, init = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  const body = res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text
  return { status: res.status, body }
}

const check = (label, cond) => {
  assert.ok(cond, label)
  console.log('  ✓', label)
}

// --- auth ---------------------------------------------------------------
{
  const res = await fetch(BASE + '/api/projects')
  check('no key is rejected with 401', res.status === 401)
  const bad = await fetch(BASE + '/api/projects', { headers: { 'x-api-key': 'nope' } })
  check('a wrong key is rejected with 401', bad.status === 401)
}

// --- projects -----------------------------------------------------------
const { body: { projects } } = await api('/api/projects')
check('projects list returns an array', Array.isArray(projects))
const project = projects[0]
assert.ok(project, 'create at least one project in the UI before running this')

// --- create -------------------------------------------------------------
const stamp = Date.now()
const created = await api('/api/tasks', {
  method: 'POST',
  body: JSON.stringify({
    project: project.slug,
    title: `contract probe ${stamp}`,
    description: 'DESC',
    requirement: 'REQ',
    prerequisites: 'PRE',
    notes: 'CAVEAT: probe task, safe to delete',
    type: 'chore',
    priority: 'high',
    status: 'todo',
  }),
})
check('POST /api/tasks returns 201', created.status === 201)
const id = created.body.id
check('created task has an id', typeof id === 'string' && id.length > 0)
check('defaults and explicit values both applied',
  created.body.status === 'todo' && created.body.type === 'chore' && created.body.assignee === '')

// --- missing fields -----------------------------------------------------
{
  const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project: project.slug }) })
  check('POST without a title is a 400', r.status === 400)
  const r2 = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project: 'nope', title: 'x' }) })
  check('POST to an unknown project is a 404', r2.status === 404)
}

// --- fix round 1: enum presence vs truthiness (Finding 1) ---------------
// `status: ""` is present but falsy. A truthiness guard (`body[field] &&`)
// skips validation entirely and lets the empty string reach Appwrite's enum
// write as an uncaught 500. A presence guard (`field in body`) catches it.
{
  const r = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ project: project.slug, title: 'empty status probe', status: '' }),
  })
  check('POST with status: "" is a 400, not a 500', r.status === 400)
}

// --- list / filter ------------------------------------------------------
{
  const r = await api(`/api/tasks?project=${project.slug}&status=todo`)
  check('GET filters by status', r.body.tasks.some(t => t.id === id))
  const r2 = await api(`/api/tasks?project=${project.slug}&status=done`)
  check('GET excludes non-matching statuses', !r2.body.tasks.some(t => t.id === id))
  const r3 = await api(`/api/tasks?project=${project.slug}`)
  check('GET with no status filter returns every status', r3.body.tasks.some(t => t.id === id))
}

// --- partial update -----------------------------------------------------
{
  const r = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ result: 'RESULT ONLY' }),
  })
  check('PATCH returns 200', r.status === 200)
  check('PATCH wrote result', r.body.result === 'RESULT ONLY')
  check('PATCH left description untouched', r.body.description === 'DESC')
  check('PATCH left requirement untouched', r.body.requirement === 'REQ')
  check('PATCH left prerequisites untouched', r.body.prerequisites === 'PRE')
  check('PATCH left notes untouched', r.body.notes.startsWith('CAVEAT'))

  // projectId must be dropped, not honoured. Paired with a writable field so
  // the request is not rejected outright for having nothing to write.
  const moved = await api(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ projectId: 'somewhere-else', title: `contract probe ${stamp}` }),
  })
  check('PATCH cannot move a task between projects', moved.body.projectId === project.id)

  const nothing = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ projectId: 'somewhere-else' }),
  })
  check('PATCH with no writable field is a 400', nothing.status === 400)

  // Fix round 1, Finding 1 — same presence-vs-truthiness bug on the PATCH side.
  const emptyStatus = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: '' }),
  })
  check('PATCH with status: "" is a 400, not a 500', emptyStatus.status === 400)
}

// --- move between columns ----------------------------------------------
{
  const r = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'in_progress', order: 1.5 }),
  })
  check('PATCH moves a task between columns',
    r.body.status === 'in_progress' && r.body.order === 1.5)
}

// --- work log -----------------------------------------------------------
{
  const r = await api(`/api/tasks/${id}/log`, {
    method: 'POST', body: JSON.stringify({ body: 'probe log entry' }),
  })
  check('POST log returns 201', r.status === 201)
  check('log author defaults to the API key label',
    typeof r.body.author === 'string' && r.body.author.length > 0 && r.body.author === keyRecord.label)

  const empty = await api(`/api/tasks/${id}/log`, { method: 'POST', body: JSON.stringify({}) })
  check('POST log without a body is a 400', empty.status === 400)

  // Ruling 59: author is always the authenticated caller and is deliberately
  // not client-settable — a forged attribution in an append-only,
  // uncorrectable log would be permanent. A client-supplied `author` must be
  // silently ignored, not honoured.
  const spoofed = await api(`/api/tasks/${id}/log`, {
    method: 'POST', body: JSON.stringify({ body: 'spoof attempt', author: 'Someone Else' }),
  })
  check('a client-supplied author is ignored — the entry is still attributed to the key',
    spoofed.status === 201 && spoofed.body.author === keyRecord.label)

  // Fix round 1, Finding 2 (Ruling 62): an empty array for a task id that
  // does not exist is indistinguishable from "this task exists and has no
  // history" — the same swallow-absence-as-data defect already fixed once
  // in getTask. GET must 404 like every other handler, matching what POST
  // on this same route already does.
  const missing = await api('/api/tasks/does-not-exist-fixround1/log')
  check('GET log on an unknown task id is a 404, not an empty list', missing.status === 404)
}

// --- both doors at once (Ruling 56) --------------------------------------
// Task 8 could not prove "an API key wins over a live session cookie" with a
// real HTTP request, because no route called resolveCaller yet. This is
// that missing proof: a request carrying BOTH a valid X-API-Key header and a
// real session cookie must resolve as the key, not the user. Constructed the
// same way test/auth-probe.mjs builds a real session: via createSession(),
// in-process, against the live Appwrite server.
{
  const { createSession, destroySession } = await import('../lib/auth.ts')
  const { Account } = await import('node-appwrite')
  const { sessionClient } = await import('../lib/appwrite.ts')

  const session = await createSession(process.env.TEST_EMAIL, process.env.TEST_PASSWORD)
  assert.ok(session.ok, `both-doors check needs a real session — createSession returned ${JSON.stringify(session)}`)
  const me = await new Account(sessionClient(session.secret)).get()

  const res = await fetch(`${BASE}/api/tasks/${id}/log`, {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'content-type': 'application/json',
      cookie: `tt_session=${session.secret}`,
    },
    body: JSON.stringify({ body: 'both-doors probe entry' }),
  })
  const entry = await res.json()
  check('a request carrying both a valid API key and a live session cookie resolves as the key, not the user',
    res.status === 201 && entry.author === keyRecord.label && entry.author !== (me.name || me.email))

  await destroySession(session.secret)
}

// --- context ------------------------------------------------------------
{
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
  const r = await api(`/api/context?project=${project.slug}`)
  check('context returns markdown', typeof r.body === 'string' && r.body.includes('# '))
  check('context leads with Keep in mind', r.body.indexOf('Keep in mind') < r.body.indexOf('Open tasks'))
  check('a note on a DONE task still reaches Keep in mind',
    r.body.slice(r.body.indexOf('Keep in mind'), r.body.indexOf('Open tasks')).includes('CAVEAT'))
  check('a done task appears under Done with its result',
    r.body.slice(r.body.indexOf('## Done')).includes('RESULT ONLY'))
  check('context includes the task id for follow-up writes', r.body.includes(id))
}

console.log('\nall contract checks passed')
