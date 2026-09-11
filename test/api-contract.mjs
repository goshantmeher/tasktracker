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
// instead of just "some non-empty string". deleteTask is looked up the same
// way for the same reason: no REST DELETE route exists (by design — see
// lib/db.ts), so cleanup below has to go straight through lib/db.ts too.
const { findKeyByHash, deleteTask, getTask } = await import('../lib/db.ts')
const { hashKey } = await import('../lib/keys.mjs')
const keyRecord = await findKeyByHash(hashKey(KEY))
assert.ok(keyRecord, 'TEST_API_KEY does not resolve to a real key record')

// A blank document id used to collapse Appwrite's /documents/<id> path down to
// the collection endpoint, which in 1.9 is the *bulk* API: updateTask('', {
// status }) was accepted as "update every row in tasks" and rewrote a whole
// live board. lib/db.ts rejects blank ids at the one place every door routes
// through; this is the check that it still does. Read-only on purpose — if
// the guard ever regresses, this fails without touching a single row.
await assert.rejects(() => getTask(''), /document id is required/,
  'a blank id must never reach Appwrite')

// Every task this run creates against the real, live Appwrite project, so it
// can be removed again at the end — even if an assertion above throws.
// Anything already in the database before this run started (including
// earlier runs' residue) is never touched: this only deletes ids this run
// itself just created and pushed here.
const createdTaskIds = []

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

try {
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
  // TEST_PROJECT names the board this run is allowed to write to. Without
  // it the suite writes its probe tasks into whatever project happens to be
  // first — which on a shared instance is a real board someone is working.
  const wanted = process.env.TEST_PROJECT
  const project = wanted ? projects.find(p => p.slug === wanted) : projects[0]
  assert.ok(project, wanted
    ? `TEST_PROJECT=${wanted} does not match any project slug`
    : 'create at least one project in the UI before running this')
  console.log(`  · writing probe tasks to "${project.slug}"`)

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
  if (id) createdTaskIds.push(id)
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

  // --- labels and fields: the same narrowing the MCP door does -------------
  {
    const tagged = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project: project.slug, title: `label probe ${stamp}`, labels: ['store', 'money'],
      }),
    })
    createdTaskIds.push(tagged.body.id)

    const created = await api('/api/tasks', {
      method: 'POST', body: JSON.stringify({ project: project.slug, title: `untagged probe ${stamp}` }),
    })
    createdTaskIds.push(created.body.id)
    check('a task created with no labels is defaulted, not left unreachable',
      JSON.stringify(created.body.labels) === JSON.stringify(['untriaged']))

    const all = await api(`/api/tasks?project=${project.slug}&labels=store,money&match=all`)
    check('labels + match=all returns only tasks carrying every label',
      all.body.tasks.length === 1 && all.body.tasks[0].id === tagged.body.id)

    const any = await api(`/api/tasks?project=${project.slug}&labels=store,untriaged&match=any`)
    check('match=any returns tasks carrying either',
      any.body.tasks.some(t => t.id === tagged.body.id)
      && any.body.tasks.some(t => t.id === created.body.id))

    const single = await api(`/api/tasks?project=${project.slug}&label=store`)
    check('the original single label parameter still behaves as it did',
      single.body.tasks.length === 1 && single.body.tasks[0].id === tagged.body.id)

    const badMatch = await api(`/api/tasks?project=${project.slug}&match=sideways`)
    check('an unknown match is a 400', badMatch.status === 400)

    const index = await api(`/api/tasks?project=${project.slug}&fields=id,title,status`)
    check('fields returns only those keys, not every markdown body',
      index.body.tasks.every(t => Object.keys(t).join() === 'id,title,status'))

    const typo = await api(`/api/tasks?project=${project.slug}&fields=titel`)
    check('a misspelled field is a 400 naming the real ones',
      typo.status === 400 && typo.body.error.includes('title'))
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

  // --- fix round 2: labels count cap (Finding 2) --------------------------
  // checkLabels (app/api/_util.ts) now enforces LABEL_COUNT_MAX on the REST
  // side, matching the same cap app/p/[slug]/actions.ts's saveScalars throws
  // on for a human's Save — neither door can write more labels than the
  // other can display/edit.
  {
    const tooMany = await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ labels: Array.from({ length: 21 }, (_, i) => `l${i}`) }),
    })
    check('PATCH with more than 20 labels is a 400, not a silent write', tooMany.status === 400)
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

  // --- fix round 2, fix 1: login never 500s on a body it can't parse ------
  // Runs unconditionally (no real credentials needed — both cases fail
  // before credentials are even checked).
  {
    const badJson = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    })
    check('login with unparseable JSON is a 400, not a 500', badJson.status === 400)

    const noBody = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    })
    check('login with no email/password is a 400, not a 500', noBody.status === 400)
  }

  // --- both front doors agree ---------------------------------------------
  if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
    // Log in the way a browser does and keep the Set-Cookie.
    const form = new URLSearchParams({
      email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD,
    })
    const login = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    check('cookie login succeeded', login.status === 200 && cookie?.startsWith('tt_session='))

    // Fix round 2, fix 1: the JSON door, same credentials, same route. Used
    // to unconditionally call req.formData() and 500 on a JSON body.
    const jsonLogin = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
    })
    const jsonCookie = jsonLogin.headers.get('set-cookie')?.split(';')[0]
    check('login also accepts a JSON body, not just form-encoded',
      jsonLogin.status === 200 && jsonCookie?.startsWith('tt_session='))

    const viaCookie = await fetch(`${BASE}/api/tasks?project=${project.slug}`, {
      headers: { cookie },
    })
    const cookieBody = await viaCookie.json()
    const viaKey = await api(`/api/tasks?project=${project.slug}`)

    check('cookie caller is accepted by /api', viaCookie.status === 200)
    check('cookie and key see identical task lists',
      JSON.stringify(cookieBody.tasks.map(t => t.id).sort()) ===
      JSON.stringify(viaKey.body.tasks.map(t => t.id).sort()))

    // And a write through the cookie is visible through the key.
    const w = await fetch(`${BASE}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ assignee: 'cookie-writer' }),
    })
    check('cookie caller can write', w.status === 200)
    const readBack = await api(`/api/tasks/${id}`)
    check('a cookie write is visible to a key read', readBack.body.assignee === 'cookie-writer')
  } else {
    console.log('  – skipped cross-door checks (set TEST_EMAIL and TEST_PASSWORD)')
  }

} finally {
  // Cleanup runs even when an assertion above threw — a failed run must
  // not leave permanent residue in the user's real Appwrite any more than
  // a passing one does.
  for (const tid of createdTaskIds) {
    try {
      await deleteTask(tid)
    } catch (e) {
      console.error('  ! cleanup failed for', tid, e)
    }
  }
  if (createdTaskIds.length) console.log(`  (cleaned up ${createdTaskIds.length} probe task(s))`)
}

console.log('\nall contract checks passed')
