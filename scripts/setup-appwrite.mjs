// SDK surface: node-appwrite@29.0.0 exports both `Databases` and `TablesDB`.
// This script uses `Databases` (createDocument/listDocuments/etc, documents/$id) —
// that surface is what the rest of this project's code is written against.
//
// `IndexType` (the exact name used in the task brief) is not exported by this
// version; the closest export is `DatabasesIndexType`. Rather than add that
// import, this script uses the string literals Appwrite's API expects
// directly: 'unique' and 'key'.

import { Client, Databases } from 'node-appwrite'
import { readFileSync } from 'node:fs'

// Load .env.local without a dependency.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const DB = process.env.APPWRITE_DATABASE_ID
const db = new Databases(
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
    const { attributes } = await db.getCollection(DB, col)
    if (attributes.every(a => a.status === 'available')) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`attributes for ${col} never became available`)
}

await ok('database', () => db.create(DB, 'tasktracker'))

await ok('projects', () => db.createCollection(DB, 'projects', 'projects'))
await ok('projects.name', () => db.createStringAttribute(DB, 'projects', 'name', 128, true))
await ok('projects.slug', () => db.createStringAttribute(DB, 'projects', 'slug', 64, true))
await ok('projects.archived', () => db.createBooleanAttribute(DB, 'projects', 'archived', false, false))
await settle('projects')
await ok('projects/slug_unique', () => db.createIndex(DB, 'projects', 'slug_unique', 'unique', ['slug']))

await ok('tasks', () => db.createCollection(DB, 'tasks', 'tasks'))
await ok('tasks.projectId', () => db.createStringAttribute(DB, 'tasks', 'projectId', 36, true))
await ok('tasks.title', () => db.createStringAttribute(DB, 'tasks', 'title', 256, true))
for (const f of ['description', 'requirement', 'prerequisites', 'result', 'notes']) {
  await ok(`tasks.${f}`, () => db.createStringAttribute(DB, 'tasks', f, 65535, false))
}
await ok('tasks.type', () => db.createEnumAttribute(DB, 'tasks', 'type', ['bug', 'feature', 'chore'], false, 'feature'))
await ok('tasks.status', () => db.createEnumAttribute(DB, 'tasks', 'status', ['backlog', 'todo', 'in_progress', 'blocked', 'done'], false, 'backlog'))
await ok('tasks.priority', () => db.createEnumAttribute(DB, 'tasks', 'priority', ['low', 'medium', 'high', 'urgent'], false, 'medium'))
await ok('tasks.assignee', () => db.createStringAttribute(DB, 'tasks', 'assignee', 64, false))
await ok('tasks.labels', () => db.createStringAttribute(DB, 'tasks', 'labels', 64, false, undefined, true))
await ok('tasks.order', () => db.createFloatAttribute(DB, 'tasks', 'order', true))
await settle('tasks')
await ok('tasks/by_project_status', () => db.createIndex(DB, 'tasks', 'by_project_status', 'key', ['projectId', 'status']))
await ok('tasks/by_project_order', () => db.createIndex(DB, 'tasks', 'by_project_order', 'key', ['projectId', 'order']))

await ok('worklog', () => db.createCollection(DB, 'worklog', 'worklog'))
await ok('worklog.taskId', () => db.createStringAttribute(DB, 'worklog', 'taskId', 36, true))
await ok('worklog.author', () => db.createStringAttribute(DB, 'worklog', 'author', 64, true))
await ok('worklog.body', () => db.createStringAttribute(DB, 'worklog', 'body', 65535, true))
await settle('worklog')
await ok('worklog/by_task', () => db.createIndex(DB, 'worklog', 'by_task', 'key', ['taskId']))

await ok('api_keys', () => db.createCollection(DB, 'api_keys', 'api_keys'))
await ok('api_keys.label', () => db.createStringAttribute(DB, 'api_keys', 'label', 64, true))
await ok('api_keys.hash', () => db.createStringAttribute(DB, 'api_keys', 'hash', 64, true))
await ok('api_keys.lastUsedAt', () => db.createDatetimeAttribute(DB, 'api_keys', 'lastUsedAt', false))
await ok('api_keys.createdBy', () => db.createStringAttribute(DB, 'api_keys', 'createdBy', 64, true))
await settle('api_keys')
await ok('api_keys/hash_unique', () => db.createIndex(DB, 'api_keys', 'hash_unique', 'unique', ['hash']))

console.log('\nschema ready')
