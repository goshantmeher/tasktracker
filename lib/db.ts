import { Databases, ID, Query, AppwriteException, type Models } from 'node-appwrite'
import { serverClient, DB } from './appwrite'
import { orderBetween } from './order.mjs'
import { STATUSES, type Status, type Task, type TaskInput, type Project, type LogEntry } from './shared'

// NOTE: written against node-appwrite's `Databases` API. If the installed SDK
// exposes `TablesDB` instead, see Task 1 Step 2 for the name translation.
const db = () => new Databases(serverClient())

// Query.limit(100) used to be the default here, which silently truncated any
// list past 100 results with no error or warning. Verified against this
// server (Appwrite 1.9.0): its own validation accepts a limit up to the
// int64 ceiling (9,223,372,036,854,775,807), and a real result set is NOT
// clamped below the requested limit — with 150 real documents, limit(101)
// returned 101 and limit(1000) returned all 150. So 100 was never a
// server-imposed cap. This default is generous instead of arbitrary; the
// real ceiling is response size / memory for very large result sets. If a
// project or column ever realistically needs more than this in one call,
// switch to cursor-based pagination (Query.cursorAfter) rather than raising
// this further.
const DEFAULT_LIST_LIMIT = 5000

// Re-exported so server-side callers have one import site. Client components
// and middleware must import these from './shared' directly instead.
export { STATUSES, TYPES, PRIORITIES, MD_FIELDS } from './shared'
export type { Status, Task, TaskInput, Project, LogEntry } from './shared'

// --- internal call helpers -------------------------------------------------
// The three repeated shapes behind every function below: list+map,
// list-and-take-first+map, get-by-id+map (null on not-found), and
// create/update+map. Collection name + queries/data + mapper in, model out.
// Nothing fancier than that: no repository class, no query builder.

async function listDocs<T>(
  collection: string, queries: string[], toModel: (d: Models.DefaultDocument) => T,
): Promise<T[]> {
  const res = await db().listDocuments(DB, collection, queries)
  return res.documents.map(toModel)
}

async function firstDoc<T>(
  collection: string, queries: string[], toModel: (d: Models.DefaultDocument) => T,
): Promise<T | null> {
  const res = await db().listDocuments(DB, collection, queries)
  return res.documents[0] ? toModel(res.documents[0]) : null
}

async function docById<T>(
  collection: string, id: string, toModel: (d: Models.DefaultDocument) => T,
): Promise<T | null> {
  try {
    return toModel(await db().getDocument(DB, collection, id))
  } catch (e) {
    // Only a real "no such document" is absence. Anything else — a network
    // failure, an unauthorized key, a malformed id, a misconfigured
    // collection — must propagate, not be reported to the caller as a 404.
    // Verified against live Appwrite: not-found is an AppwriteException with
    // code 404 and type 'document_not_found' specifically. A bad id is code
    // 400 general_argument_invalid; an unauthorized key is 401
    // user_unauthorized; an unknown collection is 404 collection_not_found
    // (a real config error, not a missing document); a network failure
    // isn't an AppwriteException at all (it's a plain fetch TypeError).
    if (e instanceof AppwriteException && e.code === 404 && e.type === 'document_not_found') {
      return null
    }
    throw e
  }
}

async function insertDoc<T>(
  collection: string, data: Record<string, unknown>, toModel: (d: Models.DefaultDocument) => T,
): Promise<T> {
  return toModel(await db().createDocument(DB, collection, ID.unique(), data))
}

async function patchDoc<T>(
  collection: string, id: string, data: Record<string, unknown>, toModel: (d: Models.DefaultDocument) => T,
): Promise<T> {
  return toModel(await db().updateDocument(DB, collection, id, data))
}

// ----------------------------------------------------------------------------

// Models.Document has no field index signature; DefaultDocument does, and is
// what listDocuments/createDocument/updateDocument actually resolve to when
// called without an explicit generic (as every call in this file does).
const toProject = (d: Models.DefaultDocument): Project => ({
  id: d.$id,
  name: d.name as string,
  slug: d.slug as string,
  archived: Boolean(d.archived),
})

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

export async function listProjects(): Promise<Project[]> {
  const all = await listDocs('projects', [Query.orderAsc('name'), Query.limit(DEFAULT_LIST_LIMIT)], toProject)
  // Archived sort below the rest, per the spec.
  return [...all.filter(p => !p.archived), ...all.filter(p => p.archived)]
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  return firstDoc('projects', [Query.equal('slug', slug), Query.limit(1)], toProject)
}

export async function createProject(name: string): Promise<Project> {
  return insertDoc('projects', { name, slug: slugify(name), archived: false }, toProject)
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  await db().updateDocument(DB, 'projects', id, { archived })
}

// Not in the original task interface list; added for the probe script's
// cleanup and because later tasks will want it too.
export async function deleteProject(id: string): Promise<void> {
  await db().deleteDocument(DB, 'projects', id)
}

const toTask = (d: Models.DefaultDocument): Task => ({
  id: d.$id,
  projectId: d.projectId as string,
  title: d.title as string,
  description: (d.description as string) ?? '',
  requirement: (d.requirement as string) ?? '',
  prerequisites: (d.prerequisites as string) ?? '',
  result: (d.result as string) ?? '',
  notes: (d.notes as string) ?? '',
  type: d.type as Task['type'],
  status: d.status as Status,
  priority: d.priority as Task['priority'],
  assignee: (d.assignee as string) ?? '',
  labels: (d.labels as string[]) ?? [],
  order: d.order as number,
  updatedAt: d.$updatedAt,
})

export type TaskFilter = {
  projectId: string
  status?: Status[]
  assignee?: string
  type?: string[]
  label?: string
  limit?: number
}

export async function listTasks(f: TaskFilter): Promise<Task[]> {
  const q = [Query.equal('projectId', f.projectId), Query.orderAsc('order')]
  if (f.status?.length) q.push(Query.equal('status', f.status))
  if (f.type?.length) q.push(Query.equal('type', f.type))
  if (f.assignee) q.push(Query.equal('assignee', f.assignee))
  // `labels` is an array attribute. Query.contains happens to work here too
  // (verified against live Appwrite), but the SDK's own doc comment says
  // array attributes should use containsAny/containsAll instead, so that's
  // what this uses — the documented contract, not a coincidence that could
  // break on a future server/SDK version.
  if (f.label) q.push(Query.containsAny('labels', [f.label]))
  q.push(Query.limit(f.limit ?? DEFAULT_LIST_LIMIT))
  const tasks = await listDocs('tasks', q, toTask)
  // Group by status in the canonical column order, ordered within each column.
  return tasks.sort((a, b) =>
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.order - b.order)
}

export async function getTask(id: string): Promise<Task | null> {
  return docById('tasks', id, toTask)
}

/** One past the last card in a column, so new tasks land at the bottom. */
export async function bottomOrder(projectId: string, status: Status): Promise<number> {
  const res = await db().listDocuments(DB, 'tasks', [
    Query.equal('projectId', projectId),
    Query.equal('status', status),
    Query.orderDesc('order'),
    Query.limit(1),
  ])
  const last = res.documents[0]
  return orderBetween(last ? (last.order as number) : null, null)
}

export async function createTask(projectId: string, input: Partial<TaskInput> & { title: string }) {
  const status = (input.status ?? 'backlog') as Status
  return insertDoc('tasks', {
    projectId,
    title: input.title,
    description: input.description ?? '',
    requirement: input.requirement ?? '',
    prerequisites: input.prerequisites ?? '',
    result: input.result ?? '',
    notes: input.notes ?? '',
    type: input.type ?? 'feature',
    status,
    priority: input.priority ?? 'medium',
    assignee: input.assignee ?? '',
    labels: input.labels ?? [],
    order: input.order ?? (await bottomOrder(projectId, status)),
  }, toTask)
}

/**
 * Partial update. Only keys present in `patch` are sent to Appwrite, which is
 * what stops a caller writing `result` from clobbering a `requirement` it
 * never read.
 */
export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Task> {
  const allowed: (keyof TaskInput)[] = [
    'title', 'description', 'requirement', 'prerequisites', 'result', 'notes',
    'type', 'status', 'priority', 'assignee', 'labels', 'order',
  ]
  const body: Record<string, unknown> = {}
  for (const k of allowed) if (k in patch) body[k] = patch[k]
  return patchDoc('tasks', id, body, toTask)
}

// Not in the original task interface list; needed by the REST API (Task 9)
// and by the partial-update probe's cleanup.
export async function deleteTask(id: string): Promise<void> {
  await db().deleteDocument(DB, 'tasks', id)
}

const toLog = (d: Models.DefaultDocument): LogEntry => ({
  id: d.$id,
  taskId: d.taskId as string,
  author: d.author as string,
  body: d.body as string,
  createdAt: d.$createdAt,
})

/** Oldest first — the stream reads top to bottom as it happened. */
export async function listLog(taskId: string, limit = 50): Promise<LogEntry[]> {
  return listDocs('worklog', [
    Query.equal('taskId', taskId),
    Query.orderAsc('$createdAt'),
    Query.limit(limit),
  ], toLog)
}

/** Append-only. There is deliberately no update or delete in the product API. */
export async function addLog(taskId: string, author: string, body: string): Promise<LogEntry> {
  return insertDoc('worklog', { taskId, author: author.slice(0, 64), body }, toLog)
}

/**
 * Most recent entries for many tasks at once, for /api/context.
 *
 * One query per task, issued in parallel — not a single batched query
 * under one shared limit. A shared limit orders globally across every
 * task, so any fixed headroom is defeated by one task with more entries
 * than the headroom: it silently crowds quieter tasks' real entries out
 * of the window entirely, indistinguishable from those tasks having no
 * history. A probe with deliberately unequal volume (1 chatty task with
 * 120 entries vs. 3 quiet tasks with 1 each) confirmed exactly that
 * failure — see task-7-report.md. Per-task queries are correct by
 * construction instead: each task's own quota can never be crowded out
 * by another task's volume.
 *
 * Cost scales with taskIds.length (one indexed query per task, run
 * concurrently) — fine for a realistic context set (tens of open tasks),
 * but a caller should bound that set rather than pass an unbounded list.
 */
export async function recentLogByTask(taskIds: string[], perTask = 3): Promise<Map<string, LogEntry[]>> {
  if (taskIds.length === 0) return new Map()
  const perTaskLists = await Promise.all(taskIds.map(async taskId => {
    const res = await db().listDocuments(DB, 'worklog', [
      Query.equal('taskId', taskId),
      Query.orderDesc('$createdAt'),
      Query.limit(perTask),
    ])
    // Newest first from the query; flip to chronological for the caller.
    return [taskId, res.documents.map(toLog).reverse()] as const
  }))
  return new Map(perTaskLists.filter(([, entries]) => entries.length > 0))
}

// PROBE-ONLY. Not part of the product API — listLog/addLog are
// deliberately append-only with no update or delete exposed to any
// server action or UI, and the REST API (Task 9) must not expose a
// delete route for worklog either; the append-only guarantee is a
// product property, not just this file's. This exists solely so probe
// scripts, which write real documents against live Appwrite, can remove
// what they created; nothing in app/ calls it. Mirrors
// deleteTask/deleteProject above, added for the same reason.
export async function deleteLog(id: string): Promise<void> {
  await db().deleteDocument(DB, 'worklog', id)
}
