'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createProject, setArchived, slugify, getProjectBySlug } from '@/lib/db'

// Every server action re-checks the session. Middleware only checks that a
// cookie exists; this is where a forged or expired one is actually rejected.
async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

export async function addProject(formData: FormData) {
  await requireUser()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  if (!slugify(name)) return            // e.g. a name of only punctuation
  if (await getProjectBySlug(slugify(name))) return   // slug is unique-indexed
  await createProject(name)
  revalidatePath('/')
}

export async function toggleArchived(formData: FormData) {
  await requireUser()
  const id = String(formData.get('id'))
  const archived = String(formData.get('archived')) === 'true'
  await setArchived(id, archived)
  revalidatePath('/')
}
