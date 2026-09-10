import { cookies } from 'next/headers'
import { Account } from 'node-appwrite'
import { adminClient, sessionClient } from './appwrite'
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

export type SessionResult =
  | { ok: true; secret: string; expire: string }
  | { ok: false; reason: 'invalid_credentials' | 'no_secret' }

/**
 * Drives Appwrite's email/password login. Runs on adminClient() (key +
 * project, no session) rather than a keyless client: Appwrite only returns a
 * real `session.secret` to a caller holding a server key. A keyless client
 * gets a valid-looking session back — HTTP 200, every field populated —
 * except `secret` is the empty string. That failure is silent, so it is
 * checked here, explicitly, before this ever reports success. Do not remove
 * or weaken this check; see lib/appwrite.ts's adminClient() doc for the
 * measured before/after (0 chars keyless, 396 with a key).
 */
export async function createSession(email: string, password: string): Promise<SessionResult> {
  let session
  try {
    session = await new Account(adminClient()).createEmailPasswordSession(email, password)
  } catch {
    return { ok: false, reason: 'invalid_credentials' }
  }
  if (!session.secret) return { ok: false, reason: 'no_secret' }
  return { ok: true, secret: session.secret, expire: session.expire }
}

/** Deletes the Appwrite session behind `secret`. Tolerant of an already-invalid secret. */
export async function destroySession(secret: string): Promise<void> {
  try {
    await new Account(sessionClient(secret)).deleteSession('current')
  } catch {
    // Already invalid/expired on Appwrite's side — nothing more to do.
  }
}
