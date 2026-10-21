// SDK surface: node-appwrite@29.0.0's `TablesDB` (createTable/create*Column/
// createIndex), the same surface lib/db.ts is written against. The legacy
// `Databases` API needs scopes Appwrite 2.3 deprecates.
//
// `IndexType` (the exact name used in the task brief) is not exported by this
// version; the closest export is `TablesDBIndexType`. Rather than add that
// import, this script uses the string literals Appwrite's API expects
// directly: 'unique' and 'key'.

import { Client, TablesDB } from 'node-appwrite'
import { readFileSync } from 'node:fs'

// Load .env.local without a dependency.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const DB = process.env.APPWRITE_DATABASE_ID
const db = new TablesDB(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY)
)

// Appwrite throws 409 when a resource already exists. Swallow only that.
const ok = async (label, fn) => {
  try { await fn(); console.log('created', label) }
  catch (e) {
    if (e.code === 409) console.log('exists  ', label)
    else throw e
  }
}

// Attributes are created asynchronously; an index on a not-yet-available
// attribute fails. Poll until every attribute in the collection is ready.
const settle = async (col) => {
  for (let i = 0; i < 60; i++) {
    const { columns } = await db.getTable(DB, col)
    if (columns.every(a => a.status === 'available')) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`attributes for ${col} never became available`)
}

await ok('database', () => db.create(DB, 'tasktracker'))

await ok('projects', () => db.createTable(DB, 'projects', 'projects'))
await ok('projects.name', () => db.createStringColumn(DB, 'projects', 'name', 128, true))
await ok('projects.slug', () => db.createStringColumn(DB, 'projects', 'slug', 64, true))
await ok('projects.archived', () => db.createBooleanColumn(DB, 'projects', 'archived', false, false))
await settle('projects')
await ok('projects/slug_unique', () => db.createIndex(DB, 'projects', 'slug_unique', 'unique', ['slug']))

await ok('tasks', () => db.createTable(DB, 'tasks', 'tasks'))
await ok('tasks.projectId', () => db.createStringColumn(DB, 'tasks', 'projectId', 36, true))
await ok('tasks.title', () => db.createStringColumn(DB, 'tasks', 'title', 256, true))
for (const f of ['description', 'requirement', 'prerequisites', 'result', 'notes']) {
  await ok(`tasks.${f}`, () => db.createStringColumn(DB, 'tasks', f, 65535, false))
}
await ok('tasks.type', () => db.createEnumColumn(DB, 'tasks', 'type', ['bug', 'feature', 'chore'], false, 'feature'))
await ok('tasks.status', () => db.createEnumColumn(DB, 'tasks', 'status', ['backlog', 'todo', 'in_progress', 'blocked', 'done'], false, 'backlog'))
await ok('tasks.priority', () => db.createEnumColumn(DB, 'tasks', 'priority', ['low', 'medium', 'high', 'urgent'], false, 'medium'))
await ok('tasks.assignee', () => db.createStringColumn(DB, 'tasks', 'assignee', 64, false))
await ok('tasks.labels', () => db.createStringColumn(DB, 'tasks', 'labels', 64, false, undefined, true))
await ok('tasks.order', () => db.createFloatColumn(DB, 'tasks', 'order', true))
await settle('tasks')
await ok('tasks/by_project_status', () => db.createIndex(DB, 'tasks', 'by_project_status', 'key', ['projectId', 'status']))
await ok('tasks/by_project_order', () => db.createIndex(DB, 'tasks', 'by_project_order', 'key', ['projectId', 'order']))

await ok('worklog', () => db.createTable(DB, 'worklog', 'worklog'))
await ok('worklog.taskId', () => db.createStringColumn(DB, 'worklog', 'taskId', 36, true))
await ok('worklog.author', () => db.createStringColumn(DB, 'worklog', 'author', 64, true))
await ok('worklog.body', () => db.createStringColumn(DB, 'worklog', 'body', 65535, true))
await settle('worklog')
await ok('worklog/by_task', () => db.createIndex(DB, 'worklog', 'by_task', 'key', ['taskId']))

await ok('api_keys', () => db.createTable(DB, 'api_keys', 'api_keys'))
await ok('api_keys.label', () => db.createStringColumn(DB, 'api_keys', 'label', 64, true))
await ok('api_keys.hash', () => db.createStringColumn(DB, 'api_keys', 'hash', 64, true))
await ok('api_keys.lastUsedAt', () => db.createDatetimeColumn(DB, 'api_keys', 'lastUsedAt', false))
await ok('api_keys.createdBy', () => db.createStringColumn(DB, 'api_keys', 'createdBy', 64, true))
await settle('api_keys')
await ok('api_keys/hash_unique', () => db.createIndex(DB, 'api_keys', 'hash_unique', 'unique', ['hash']))

await ok('checklist', () => db.createTable(DB, 'checklist', 'checklist'))
await ok('checklist.taskId', () => db.createStringColumn(DB, 'checklist', 'taskId', 36, true))
// Copied from the task so the board can read every item of a project in one
// query instead of one per card.
await ok('checklist.projectId', () => db.createStringColumn(DB, 'checklist', 'projectId', 36, true))
await ok('checklist.text', () => db.createStringColumn(DB, 'checklist', 'text', 512, true))
await ok('checklist.done', () => db.createBooleanColumn(DB, 'checklist', 'done', false, false))
await ok('checklist.order', () => db.createFloatColumn(DB, 'checklist', 'order', true))
await settle('checklist')
await ok('checklist/by_task', () => db.createIndex(DB, 'checklist', 'by_task', 'key', ['taskId', 'order']))
await ok('checklist/by_project', () => db.createIndex(DB, 'checklist', 'by_project', 'key', ['projectId']))

console.log('\nschema ready')
