import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}
const { Account } = await import('node-appwrite')
const { sessionClient } = await import('../lib/appwrite.ts')
const { createSession, destroySession } = await import('../lib/auth.ts')

// The whole point: createSession returns a usable secret.
const s = await createSession(process.env.TEST_EMAIL, process.env.TEST_PASSWORD)
assert.ok(s.ok, `expected ok:true, got ${JSON.stringify(s)}`)
assert.ok(s.secret && s.secret.length > 100, `expected a session secret, got ${JSON.stringify(s.secret)}`)

// And that secret authenticates as the right user.
const me = await new Account(sessionClient(s.secret)).get()
assert.equal(me.email, process.env.TEST_EMAIL)

// A bad password must signal failure, not return a secretless session.
const bad = await createSession(process.env.TEST_EMAIL, 'wrong-password')
assert.equal(bad.ok, false)
assert.equal(bad.reason, 'invalid_credentials')

// destroySession revokes a real secret...
await destroySession(s.secret)
await assert.rejects(() => new Account(sessionClient(s.secret)).get())
// ...and is tolerant of an already-invalid one (must not throw).
await destroySession(s.secret)

console.log('auth primitives verified: secret length', s.secret.length, 'as', me.email)
