'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import {
  createTask, updateTask, getProjectBySlug, getTask,
  STATUSES, TYPES, PRIORITIES, MD_FIELDS, type Status, type TaskInput,
} from '@/lib/db'
import { isAllowed } from '@/lib/shared'

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

export async function quickAddTask(slug: string, formData: FormData) {
  await requireUser()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return
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
  if (!task || task.projectId !== project.id) throw new Error('task does not belong to that project')
  return task
}

export async function saveField(slug: string, taskId: string, field: string, value: string) {
  await requireUser()
  // Whitelist, not passthrough — `field` arrives from the client.
  if (!(MD_FIELDS as readonly string[]).includes(field) && field !== 'title') {
    throw new Error(`not a writable text field: ${field}`)
  }
  await ownedTask(slug, taskId)
  await updateTask(taskId, { [field]: value } as Partial<TaskInput>)
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

export async function saveScalars(slug: string, taskId: string, formData: FormData) {
  await requireUser()
  await ownedTask(slug, taskId)
  const pick = <T extends readonly string[]>(name: string, allowed: T) => {
    const v = String(formData.get(name) ?? '')
    return isAllowed(v, allowed) ? v : undefined
  }
  await updateTask(taskId, {
    status: pick('status', STATUSES) as Status,
    type: pick('type', TYPES) as TaskInput['type'],
    priority: pick('priority', PRIORITIES) as TaskInput['priority'],
    assignee: String(formData.get('assignee') ?? '').slice(0, 64),
    labels: String(formData.get('labels') ?? '')
      .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20),
  })
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}
