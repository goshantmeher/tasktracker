'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Account } from 'node-appwrite'
import { adminClient, sessionClient } from '@/lib/appwrite'
import { SESSION_COOKIE } from '@/lib/auth'

export async function login(_prev: string | null, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return 'Email and password are required.'

  let secret: string, expire: string
  try {
    const session = await new Account(adminClient())
      .createEmailPasswordSession(email, password)
    secret = session.secret
    expire = session.expire
    // A keyless client returns a session with an empty secret. Fail loudly
    // rather than storing "" in the cookie and pretending we are logged in.
    if (!secret) return 'Login succeeded but no session secret was returned.'
  } catch {
    // Deliberately not distinguishing unknown-email from wrong-password.
    return 'Invalid email or password.'
  }

  ;(await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expire),
  })
  redirect('/')
}

export async function logout() {
  const jar = await cookies()
  const secret = jar.get(SESSION_COOKIE)?.value
  if (secret) {
    try { await new Account(sessionClient(secret)).deleteSession('current') } catch {}
  }
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}
