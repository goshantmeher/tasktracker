'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import {
  createTask, updateTask, getProjectBySlug, getTask, addLog,
  deleteTask, listLog, deleteLog,
  getChecklistItem, addChecklistItems, updateChecklistItem, deleteChecklistItem, deleteChecklist,
  STATUSES, TYPES, PRIORITIES, MD_FIELDS, type Status, type TaskInput,
} from '@/lib/db'
import {
  isAllowed, resolveAuthor, TASK_STRING_MAX, LABEL_MAX, LABEL_COUNT_MAX,
  checklistText, type ChecklistItem,
} from '@/lib/shared'

/**
 * Same TASK_STRING_MAX a REST write checks (app/api/_util.ts) against the
 * same declared Appwrite column sizes (scripts/setup-appwrite.mjs) — so a
 * human's Save is held to the same limit an agent's PATCH already is,
 * instead of reaching Appwrite unchecked and throwing.
 */
function checkLength(field: string, value: string): void {
  const max = TASK_STRING_MAX[field]
  if (max !== undefined && value.length > max) {
    throw new Error(`${field} must be at most ${max} characters`)
  }
}

async function requireUser() {
  if (!(await currentUser())) redirect('/login')
}

export async function moveTask(slug: string, taskId: string, status: Status, order: number) {
  await requireUser()
  // Data-integrity guard, not an authorization one — every authenticated
  // user can already see every project. This just stops a stale or
  // malformed call (taskId and slug arrive independently, nothing ties
  // them together otherwise) from mutating a card on a different board
  // while revalidating the wrong path.
  const project = await getProjectBySlug(slug)
  if (!project) return
  const task = await getTask(taskId)
  if (!task || task.projectId !== project.id) return
  await updateTask(taskId, { status, order })
  revalidatePath(`/p/${slug}`)
}

/**
 * Delete a task and its work log, then land back on the board.
 *
 * Deliberately a hard delete, not an archive: a task that shouldn't be on
 * the board has no other place to be in this tracker, and an `archived`
 * flag would mean a schema migration plus an "include archived?" question
 * in every list call and at both front doors. The button that calls this
 * confirms first (see delete-task.tsx) — that is the whole safety net.
 */
export async function removeTask(slug: string, taskId: string) {
  await requireUser()
  // Same integrity guard as moveTask: taskId and slug arrive independently.
  const project = await getProjectBySlug(slug)
  if (!project) return
  const task = await getTask(taskId)
  if (!task || task.projectId !== project.id) return

  for (const entry of await listLog(taskId, 500)) await deleteLog(entry.id)
  await deleteTask(taskId)
  revalidatePath(`/p/${slug}`)
  redirect(`/p/${slug}`)
}

export async function quickAddTask(slug: string, formData: FormData) {
  await requireUser()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return
  // Same declared column size (tasks.title, 256) the REST door rejects an
  // over-length title against. Thrown, not silently truncated, so the
  // client-side wrapper (see board.tsx's QuickAdd) can keep what the user
  // typed on screen instead of losing it to the route's error boundary.
  checkLength('title', title)
  const project = await getProjectBySlug(slug)
  if (!project) return
  // Whitelist, not passthrough — `status` arrives from the client (a
  // hidden field the UI always sets correctly, but nothing stops a crafted
  // POST from sending anything). An invalid value falls back to
  // createTask's own 'backlog' default rather than rejecting the whole
  // add: the field is non-sensitive (only where the card starts), and
  // silently dropping the task would be a worse failure mode than
  // misplacing it in backlog.
  const pick = <T extends readonly string[]>(name: string, allowed: T) => {
    const v = String(formData.get(name) ?? '')
    return isAllowed(v, allowed) ? v : undefined
  }
  await createTask(project.id, {
    title,
    status: pick('status', STATUSES) as Status,
  })
  revalidatePath(`/p/${slug}`)
}

/**
 * Same decoupling moveTask guards against — taskId and slug arrive
 * independently from the client, nothing else ties them together. Unlike
 * moveTask (which silently no-ops a cross-project drag), this throws: both
 * callers below are awaited and caught client-side, so a refusal has to be
 * visible there rather than look like a successful, silently-dropped save.
 */
async function ownedTask(slug: string, taskId: string) {
  const project = await getProjectBySlug(slug)
  if (!project) throw new Error('no such project')
  const task = await getTask(taskId)
  if (!task) throw new Error('no such task')
  if (task.projectId !== project.id) throw new Error('task does not belong to that project')
  return task
}

export async function saveField(slug: string, taskId: string, field: string, value: string) {
  await requireUser()
  // Whitelist, not passthrough — `field` arrives from the client.
  if (!(MD_FIELDS as readonly string[]).includes(field) && field !== 'title') {
    throw new Error(`not a writable text field: ${field}`)
  }
  // Same declared column size the REST door checks. Thrown before the
  // write, same as ownedTask's guards below — detail.tsx's MarkdownField
  // already catches this and keeps the editor open with the typed text.
  checkLength(field, value)
  await ownedTask(slug, taskId)
  await updateTask(taskId, { [field]: value } as Partial<TaskInput>)
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

export async function saveScalars(slug: string, taskId: string, formData: FormData) {
  await requireUser()
  const task = await ownedTask(slug, taskId)
  const pick = <T extends readonly string[]>(name: string, allowed: T) => {
    const v = String(formData.get(name) ?? '')
    return isAllowed(v, allowed) ? v : undefined
  }

  // Same TASK_STRING_MAX.assignee the REST door 400s an over-length
  // assignee against — thrown, not `.slice(0, 64)`'d away. Truncating an
  // over-length write is exactly the silent-corruption behaviour this
  // field's REST-side check exists to avoid; the human's Save must refuse
  // it the same way, not do it quietly.
  const assignee = String(formData.get('assignee') ?? '')
  checkLength('assignee', assignee)

  // `labels` only round-trips safely through this comma-separated text box
  // when nothing in it contains a comma — the box's own delimiter. Only
  // re-derive the array when the field actually changed (comparing against
  // the same `.join(', ')` the input's defaultValue was built from):
  // leaving it alone otherwise is what stops a human saving *just* status
  // from silently rewriting labels an agent wrote over the REST API, which
  // never touches this box at all. When it did change and an existing label
  // already contains a comma, refuse rather than silently re-split it into
  // two — this text box cannot represent that safely.
  const rawLabels = String(formData.get('labels') ?? '')
  let labels: string[] | undefined
  if (rawLabels !== task.labels.join(', ')) {
    if (task.labels.some(l => l.includes(',')))
      throw new Error('existing labels contain a comma and cannot be edited from this field — use the API')
    labels = rawLabels.split(',').map(s => s.trim()).filter(Boolean)
    if (labels.length > LABEL_COUNT_MAX) throw new Error(`labels: at most ${LABEL_COUNT_MAX} allowed`)
    if (labels.some(l => l.length > LABEL_MAX))
      throw new Error(`labels: each at most ${LABEL_MAX} characters`)
  }

  await updateTask(taskId, {
    status: pick('status', STATUSES) as Status,
    type: pick('type', TYPES) as TaskInput['type'],
    priority: pick('priority', PRIORITIES) as TaskInput['priority'],
    assignee,
    ...(labels !== undefined ? { labels } : {}),
  })
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

/**
 * Note `requireUser()` is not reused here — the action needs the caller's
 * name (for the entry's author), not just proof that they're logged in.
 */
export async function addLogEntry(slug: string, taskId: string, formData: FormData) {
  const user = await currentUser()
  if (!user) redirect('/login')
  // Same cross-project decoupling moveTask/saveField/saveScalars guard
  // against: taskId and slug arrive independently from the client.
  await ownedTask(slug, taskId)
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return
  await addLog(taskId, resolveAuthor(user.name, user.email), body)
  revalidatePath(`/p/${slug}/t/${taskId}`)
}

// --- checklist ---------------------------------------------------------------
// Same guards as the task actions above: a signed-in user, and a task that
// belongs to the slug. Items get one more — the item must belong to the task
// — since itemId arrives from the client independently of both.

async function ownedItem(slug: string, taskId: string, itemId: string) {
  await ownedTask(slug, taskId)
  const item = await getChecklistItem(itemId)
  if (!item || item.taskId !== taskId) throw new Error('no such checklist item')
  return item
}

/** The task page, and the board whose card shows the progress bar. */
function revalidateTask(slug: string, taskId: string) {
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

export async function addChecklistItem(slug: string, taskId: string, text: string) {
  await requireUser()
  const task = await ownedTask(slug, taskId)
  await addChecklistItems(task, [checklistText(text)])
  revalidateTask(slug, taskId)
}

export async function editChecklistItem(
  slug: string, taskId: string, itemId: string,
  patch: { text?: string; done?: boolean; order?: number },
) {
  await requireUser()
  await ownedItem(slug, taskId, itemId)
  // Rebuilt field by field, not passed through — `patch` is client input.
  const clean: Partial<Pick<ChecklistItem, 'text' | 'done' | 'order'>> = {}
  if (patch.text !== undefined) clean.text = checklistText(patch.text)
  if (typeof patch.done === 'boolean') clean.done = patch.done
  if (typeof patch.order === 'number' && Number.isFinite(patch.order)) clean.order = patch.order
  if (Object.keys(clean).length === 0) throw new Error('nothing to save')
  await updateChecklistItem(itemId, clean)
  revalidateTask(slug, taskId)
}

export async function removeChecklistItem(slug: string, taskId: string, itemId: string) {
  await requireUser()
  await ownedItem(slug, taskId, itemId)
  await deleteChecklistItem(itemId)
  revalidateTask(slug, taskId)
}

export async function clearChecklist(slug: string, taskId: string) {
  await requireUser()
  await ownedTask(slug, taskId)
  await deleteChecklist(taskId)
  revalidateTask(slug, taskId)
}
