'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createKey, revokeKey } from '@/lib/db'

export async function mintKey(_prev: string | null, formData: FormData) {
  const user = await currentUser()
  if (!user) redirect('/login')
  const label = String(formData.get('label') ?? '').trim()
  if (!label) return null
  const { key } = await createKey(label, user.name)
  revalidatePath('/settings/keys')
  return key // shown once, by the page; never stored in plaintext
}

export async function removeKey(formData: FormData) {
  if (!(await currentUser())) redirect('/login')
  await revokeKey(String(formData.get('id')))
  revalidatePath('/settings/keys')
}
