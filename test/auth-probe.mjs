import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}
const { Account } = await import('node-appwrite')
const { adminClient, sessionClient } = await import('../lib/appwrite.ts')

// The whole point: an admin client returns a usable secret.
const s = await new Account(adminClient())
  .createEmailPasswordSession(process.env.TEST_EMAIL, process.env.TEST_PASSWORD)
assert.ok(s.secret && s.secret.length > 100, `expected a session secret, got ${JSON.stringify(s.secret)}`)

// And that secret authenticates as the right user.
const me = await new Account(sessionClient(s.secret)).get()
assert.equal(me.email, process.env.TEST_EMAIL)

// A bad password must throw, not return a secretless session.
await assert.rejects(() => new Account(adminClient())
  .createEmailPasswordSession(process.env.TEST_EMAIL, 'wrong-password'))

console.log('auth primitives verified: secret length', s.secret.length, 'as', me.email)
