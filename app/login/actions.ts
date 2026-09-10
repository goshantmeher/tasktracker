'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSession, destroySession, SESSION_COOKIE } from '@/lib/auth'

export async function login(_prev: string | null, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return 'Email and password are required.'

  const session = await createSession(email, password)
  if (!session.ok) {
    // Deliberately not distinguishing unknown-email from wrong-password.
    if (session.reason === 'no_secret') return 'Login succeeded but no session secret was returned.'
    return 'Invalid email or password.'
  }

  ;(await cookies()).set(SESSION_COOKIE, session.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expire),
  })
  redirect('/')
}

export async function logout() {
  const jar = await cookies()
  const secret = jar.get(SESSION_COOKIE)?.value
  if (secret) await destroySession(secret)
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}
