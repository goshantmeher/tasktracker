// Dump every Appwrite collection to local JSON, and put it back again.
//
// Run before anything that writes to the live board:
//
//   node --import tsx scripts/backup.mjs                    # dump to backups/<timestamp>/
//   node --import tsx scripts/backup.mjs restore <dir>      # show what a restore would change
//   node --import tsx scripts/backup.mjs restore <dir> --write   # actually put it back
//
// Restore is an upsert keyed on $id: a document that still exists is
// overwritten with its backed-up fields, one that was deleted is recreated
// with the same id, and a document created since the backup is left alone
// (this is a restore, not a mirror — it never deletes).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { readFileSync as read } from 'node:fs'

for (const line of read('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const { Databases, Query, AppwriteException } = await import('node-appwrite')
const { serverClient, DB } = await import('../lib/appwrite.ts')
const db = new Databases(serverClient())

const COLLECTIONS = ['projects', 'tasks', 'worklog', 'api_keys']

/** Every document in a collection, paged — a dump that silently stops at a
 *  limit is worse than no dump at all. */
async function readAll(collection) {
  const out = []
  let cursor = null
  for (;;) {
    const q = [Query.limit(200), ...(cursor ? [Query.cursorAfter(cursor)] : [])]
    const { documents } = await db.listDocuments(DB, collection, q)
    out.push(...documents)
    if (documents.length < 200) return out
    cursor = documents[documents.length - 1].$id
  }
}

/** The writable half of a document: every field Appwrite didn't add itself. */
const fields = doc => Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('$')))

const [mode, dir, ...flags] = process.argv.slice(2)

if (!mode || mode === 'dump') {
  const target = `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`
  mkdirSync(target, { recursive: true })
  for (const c of COLLECTIONS) {
    const docs = await readAll(c)
    writeFileSync(`${target}/${c}.json`, JSON.stringify(docs, null, 2))
    console.log(`${c}: ${docs.length} documents`)
  }
  console.log(`\nbacked up to ${target}`)
} else if (mode === 'restore') {
  if (!dir) throw new Error('restore needs a backup directory')
  const write = flags.includes('--write')
  for (const c of COLLECTIONS) {
    const docs = JSON.parse(readFileSync(`${dir}/${c}.json`, 'utf8'))
    let updated = 0, recreated = 0
    for (const doc of docs) {
      if (!write) continue
      try {
        await db.updateDocument(DB, c, doc.$id, fields(doc))
        updated++
      } catch (e) {
        if (!(e instanceof AppwriteException && e.code === 404)) throw e
        await db.createDocument(DB, c, doc.$id, fields(doc))
        recreated++
      }
    }
    console.log(write
      ? `${c}: ${updated} overwritten, ${recreated} recreated`
      : `${c}: ${docs.length} documents would be restored (pass --write to do it)`)
  }
} else {
  throw new Error(`unknown mode: ${mode}`)
}
