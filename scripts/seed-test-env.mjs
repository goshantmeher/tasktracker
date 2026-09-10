// Discharges a debt open since Task 1: TEST_API_KEY in .env.local has been
// empty, and Tasks 9-11 cannot test the REST API front door without a real,
// live key. Mints one through the data layer (lib/db.ts's createKey — the
// exact function the /settings/keys screen calls) and writes the plaintext
// into .env.local, never to the console.
//
// Idempotent: if TEST_API_KEY already names a live, unrevoked key, this does
// nothing. Otherwise (empty, or revoked since the last run) it deletes any
// stale key row this script previously created — matched by SEED_LABEL, so
// re-runs never pile up rows — and mints one fresh key.
//
// Run with: npx tsx scripts/seed-test-env.mjs   (or: node --import tsx scripts/seed-test-env.mjs)

import { readFileSync, writeFileSync } from 'node:fs'

const ENV_PATH = '.env.local'
const SEED_LABEL = 'seed-test-env.mjs'

const envText = readFileSync(ENV_PATH, 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const { createKey, listKeys, revokeKey, findKeyByHash } = await import('../lib/db.ts')
const { hashKey } = await import('../lib/keys.mjs')

const existing = process.env.TEST_API_KEY
if (existing) {
  const record = await findKeyByHash(hashKey(existing))
  if (record) {
    console.log(`TEST_API_KEY is already set and live (label "${record.label}") — nothing to do.`)
    process.exit(0)
  }
  console.log('TEST_API_KEY is set but no longer resolves to a live key (empty, revoked, or stale) — reseeding.')
}

const stale = (await listKeys()).filter(k => k.label === SEED_LABEL)
for (const k of stale) {
  await revokeKey(k.id)
  console.log('revoked stale seed key', k.id)
}

const { key } = await createKey(SEED_LABEL, SEED_LABEL)

const updated = /^TEST_API_KEY=.*$/m.test(envText)
  ? envText.replace(/^TEST_API_KEY=.*$/m, `TEST_API_KEY=${key}`)
  : envText.trimEnd() + `\nTEST_API_KEY=${key}\n`
writeFileSync(ENV_PATH, updated)

console.log('TEST_API_KEY minted and written to .env.local (plaintext not logged here).')
