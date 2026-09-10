'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createTask, updateTask, getProjectBySlug, type Status } from '@/lib/db'

async function requireUser() {
  if (!(await currentUser())) redirect('/login')
}

export async function moveTask(slug: string, taskId: string, status: Status, order: number) {
  await requireUser()
  await updateTask(taskId, { status, order })
  revalidatePath(`/p/${slug}`)
}

export async function quickAddTask(slug: string, formData: FormData) {
  await requireUser()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return
  const project = await getProjectBySlug(slug)
  if (!project) return
  await createTask(project.id, {
    title,
    status: String(formData.get('status')) as Status,
  })
  revalidatePath(`/p/${slug}`)
}
