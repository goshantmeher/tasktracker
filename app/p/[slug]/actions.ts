'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createTask, updateTask, getProjectBySlug, getTask, STATUSES, type Status } from '@/lib/db'
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
