import { cookies } from 'next/headers'
import { Account } from 'node-appwrite'
import { sessionClient } from './appwrite'
import { SESSION_COOKIE } from './shared'

export { SESSION_COOKIE }

export type Caller = { kind: 'user' | 'key'; name: string }

/** The logged-in human, or null. Never throws on a stale cookie. */
export async function currentUser() {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value
  if (!secret) return null
  try {
    const user = await new Account(sessionClient(secret)).get()
    return { name: user.name || user.email, email: user.email }
  } catch {
    return null
  }
}
