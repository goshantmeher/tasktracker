import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const { createKey, listKeys, revokeKey, findKeyByHash, touchKey } = await import('../lib/db')
const { resolveCaller } = await import('../lib/auth')
const { generateKey, hashKey } = await import('../lib/keys.mjs')
const { Databases } = await import('node-appwrite')
const { serverClient, DB } = await import('../lib/appwrite')

// Reads the RAW Appwrite document directly (bypassing lib/db.ts's toKey
// mapper, which can't reveal a field it doesn't map anyway) so PHASE 1B can
// inspect literally everything Appwrite stored for a minted key.
const rawDb = new Databases(serverClient())
const getRaw = (id: string) => rawDb.getDocument(DB, 'api_keys', id)

const ids: string[] = []

try {
  // ---------------------------------------------------------------------
  // PHASE 1 — happy path: mint, plaintext not stored, list, resolveCaller
  // accepts it, touchKey fires.
  // ---------------------------------------------------------------------
  const label = `Probe key ${Date.now()}`
  const { key, record } = await createKey(label, 'probe-creator')
  ids.push(record.id)
  assert.equal(record.label, label)
  assert.equal(record.createdBy, 'probe-creator')
  assert.equal(record.lastUsedAt, null, 'a freshly minted key must start unused')
  console.log('1. createKey: pass — minted', { id: record.id, label: record.label, lastUsedAt: record.lastUsedAt })

  // 1B — the plaintext is NOT stored: read the real document back and check
  // every field on it, not just the ones lib/db.ts's ApiKey type exposes.
  const raw = await getRaw(record.id)
  const rawJson = JSON.stringify(raw)
  assert.equal(raw.hash, hashKey(key), 'stored hash must match hashKey(plaintext)')
  assert.notEqual(raw.hash, key, 'stored hash must not equal the plaintext key')
  assert.ok(!rawJson.includes(key), 'the plaintext key must not appear anywhere in the stored document')
  assert.deepEqual(
    Object.keys(raw).filter(k => !k.startsWith('$')).sort(),
    ['createdBy', 'hash', 'label', 'lastUsedAt'],
    'the document must carry exactly the schema fields — no extra plaintext-bearing field',
  )
  console.log('1b. plaintext is NOT stored — only hash: pass — stored fields:',
    Object.keys(raw).filter(k => !k.startsWith('$')).sort(), '(plaintext key itself withheld from this log deliberately)')

  // 1C — appears in listKeys().
  const listed = await listKeys()
  assert.ok(listed.some(k => k.id === record.id), 'minted key must appear in listKeys()')
  console.log('1c. listKeys includes the minted key: pass —', listed.length, 'total key(s) visible')

  // 1D — resolveCaller accepts the valid key and returns the right identity.
  const req = new Request('http://localhost/api/projects', { headers: { 'x-api-key': key } })
  const caller = await resolveCaller(req)
  assert.deepEqual(caller, { kind: 'key', name: label })
  console.log('1d. resolveCaller accepts a valid key: pass —', caller)

  // 1E — touchKey: both the dedicated direct call, and confirming
  // resolveCaller's internal call (1D, above) actually persisted it.
  const afterResolve = await findKeyByHash(hashKey(key))
  assert.ok(afterResolve?.lastUsedAt, 'resolveCaller must touchKey on a successful key auth')
  console.log('1e-i. touchKey fired as a side effect of resolveCaller: pass — lastUsedAt =', afterResolve?.lastUsedAt)

  await touchKey(record.id)
  const afterDirect = await findKeyByHash(hashKey(key))
  assert.ok(afterDirect?.lastUsedAt, 'touchKey must set lastUsedAt')
  assert.notEqual(afterDirect?.lastUsedAt, null)
  console.log('1e-ii. touchKey (called directly) updates lastUsedAt: pass —', afterDirect?.lastUsedAt)

  // ---------------------------------------------------------------------
  // PHASE 2 — negative paths: invalid key, revoked key, and "key wins".
  // ---------------------------------------------------------------------

  // 2A — an invalid (well-formed, real generateKey() output, but never
  // registered) key is rejected.
  const unknownKey = generateKey()
  const rejectedUnknown = await resolveCaller(
    new Request('http://localhost/api/projects', { headers: { 'x-api-key': unknownKey } }))
  assert.equal(rejectedUnknown, null, 'an unregistered key must resolve to null, not a caller')
  console.log('2a. resolveCaller rejects an invalid/unknown key: pass —', rejectedUnknown)

  // 2B — a revoked key is rejected.
  await revokeKey(record.id)
  ids.splice(ids.indexOf(record.id), 1) // already gone; don't try to revoke it again in cleanup
  const stillListed = await listKeys()
  assert.ok(!stillListed.some(k => k.id === record.id), 'a revoked key must not appear in listKeys()')
  const rejectedRevoked = await resolveCaller(
    new Request('http://localhost/api/projects', { headers: { 'x-api-key': key } }))
  assert.equal(rejectedRevoked, null, 'a revoked key must resolve to null, not the caller it used to be')
  console.log('2b. resolveCaller rejects a revoked key: pass —', rejectedRevoked)

  // 2C — "when both a valid key header and a session are present, the key
  // wins". resolveCaller's own control flow (lib/auth.ts) returns inside the
  // `if (presented)` branch on both success and failure and never reaches
  // `currentUser()` in that branch — so the session is structurally
  // unreachable whenever a key header is presented, regardless of whether a
  // session exists. Proven two ways against the REAL functions (not a stub):
  //   (i)  with NO header, resolveCaller falls through to currentUser(),
  //        which calls next/headers' cookies() — outside a live Next.js
  //        request (as this script necessarily is) that throws. This
  //        confirms the session branch is real code that actually runs, not
  //        dead code — so its absence from the key-present branch is
  //        meaningful, not accidental.
  //   (ii) with a valid header present, resolveCaller returns the key
  //        identity WITHOUT throwing — proving it never touched
  //        currentUser()/cookies() at all, even though nothing here
  //        provides a session either way.
  // A full live round-trip (one real HTTP request carrying both a session
  // cookie AND an X-API-Key header) needs an actual Next.js request context,
  // which only exists once Task 9's route handlers are live; this proves the
  // mechanism against the real, unmodified functions in the meantime.
  const { key: key2, record: record2 } = await createKey(`Probe key (2c) ${Date.now()}`, 'probe-creator')
  ids.push(record2.id)

  let noHeaderThrew: string | null = null
  try {
    await resolveCaller(new Request('http://localhost/api/projects'))
  } catch (e) {
    noHeaderThrew = e instanceof Error ? e.message : String(e)
  }
  assert.ok(noHeaderThrew, 'no-header case must fall through to currentUser()/cookies(), which throws outside a request')
  assert.match(noHeaderThrew, /request scope/i)
  console.log('2c-i. no header falls through to the real currentUser()/cookies() path: pass —', noHeaderThrew)

  const withHeader = await resolveCaller(
    new Request('http://localhost/api/projects', { headers: { 'x-api-key': key2 } }))
  assert.deepEqual(withHeader, { kind: 'key', name: record2.label })
  console.log('2c-ii. with a header present, resolveCaller resolves to the key identity ' +
    'without ever reaching the (real, throwing) session path: pass —', withHeader)

  console.log('\nALL PROBE ASSERTIONS PASSED')
} finally {
  for (const id of ids) {
    try { await revokeKey(id); console.log('cleanup: revoked', id) }
    catch (e) { console.error('cleanup FAILED for key', id, e) }
  }
}
