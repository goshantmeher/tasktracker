import { Databases, ID, Query, type Models } from 'node-appwrite'
import { serverClient, DB } from './appwrite'
import { orderBetween } from './order.mjs'
import { STATUSES, type Status, type Task, type TaskInput, type Project } from './shared'

// NOTE: written against node-appwrite's `Databases` API. If the installed SDK
// exposes `TablesDB` instead, see Task 1 Step 2 for the name translation.
const db = () => new Databases(serverClient())

// Re-exported so server-side callers have one import site. Client components
// and middleware must import these from './shared' directly instead.
export { STATUSES, TYPES, PRIORITIES, MD_FIELDS } from './shared'
export type { Status, Task, TaskInput, Project, LogEntry } from './shared'

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
  const res = await db().listDocuments(DB, 'projects', [
    Query.orderAsc('name'),
    Query.limit(100),
  ])
  const all = res.documents.map(toProject)
  // Archived sort below the rest, per the spec.
  return [...all.filter(p => !p.archived), ...all.filter(p => p.archived)]
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const res = await db().listDocuments(DB, 'projects', [Query.equal('slug', slug), Query.limit(1)])
  return res.documents[0] ? toProject(res.documents[0]) : null
}

export async function createProject(name: string): Promise<Project> {
  const doc = await db().createDocument(DB, 'projects', ID.unique(), {
    name,
    slug: slugify(name),
    archived: false,
  })
  return toProject(doc)
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
  if (f.label) q.push(Query.contains('labels', f.label))
  q.push(Query.limit(f.limit ?? 100))
  const res = await db().listDocuments(DB, 'tasks', q)
  const tasks = res.documents.map(toTask)
  // Group by status in the canonical column order, ordered within each column.
  return tasks.sort((a, b) =>
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.order - b.order)
}

export async function getTask(id: string): Promise<Task | null> {
  try {
    return toTask(await db().getDocument(DB, 'tasks', id))
  } catch {
    return null
  }
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
  const doc = await db().createDocument(DB, 'tasks', ID.unique(), {
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
  })
  return toTask(doc)
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
  return toTask(await db().updateDocument(DB, 'tasks', id, body))
}

// Not in the original task interface list; needed by the REST API (Task 9)
// and by the partial-update probe's cleanup.
export async function deleteTask(id: string): Promise<void> {
  await db().deleteDocument(DB, 'tasks', id)
}
