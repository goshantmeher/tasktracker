import { cookies } from 'next/headers'
import { Account } from 'node-appwrite'
import { adminClient, sessionClient } from './appwrite'
import { hashKey } from './keys.mjs'
import { findKeyByHash, touchKey } from './db'
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

/**
 * Writes the session cookie. Both login front doors go through here —
 * app/login/actions.ts (the browser form) and app/api/login/route.ts (every
 * non-browser client) — so the attributes cannot drift apart between them.
 *
 * sameSite: 'lax' is this app's ONLY CSRF defence. There are no CSRF tokens
 * anywhere, and resolveCaller accepts this cookie on every REST route, so a
 * login path that set 'none' here would silently open CSRF across the whole
 * API. That is why this lives in one place instead of being copied.
 */
export async function setSessionCookie(secret: string, expire: string): Promise<void> {
  ;(await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expire),
  })
}

/** Deletes the Appwrite session behind `secret`. Tolerant of an already-invalid secret. */
export async function destroySession(secret: string): Promise<void> {
  try {
    await new Account(sessionClient(secret)).deleteSession('current')
  } catch {
    // Already invalid/expired on Appwrite's side — nothing more to do.
  }
}

/**
 * Turns either front door into one identity: an `X-API-Key` header, or the
 * browser's session cookie (checked via currentUser()). The key wins when
 * both are present — checked first, and returns immediately on either
 * success or failure, so a browser-originated call carrying a key is always
 * treated as that key and the session is never consulted. Returns null when
 * neither authenticates.
 *
 * CSRF note: because this also accepts the plain session cookie, every REST
 * route under /api is reachable the same way a same-origin page's fetch is —
 * there are no CSRF tokens anywhere in this app. What actually prevents a
 * malicious third-party page from riding a logged-in user's cookie to POST
 * /PATCH/DELETE here is SESSION_COOKIE being issued with `sameSite: 'lax'`
 * (app/login/actions.ts) — lax withholds the cookie on cross-site
 * POST/PATCH/DELETE and on cross-origin fetch. That flag is the entire
 * defence and it lives in a different file: loosening it to 'none' silently
 * reopens CSRF on every route in this file without anything here warning
 * about it. If that ever needs to change, real CSRF tokens become mandatory
 * in the same change.
 */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const presented = req.headers.get('x-api-key')
  if (presented) {
    const record = await findKeyByHash(hashKey(presented))
    if (!record) return null
    // A key grants full access to every project (see lib/db.ts's API keys
    // section) — deliberately unscoped, matching the app's existing
    // no-ownership model.
    await touchKey(record.id)
    return { kind: 'key', name: record.label }
  }
  const user = await currentUser()
  return user ? { kind: 'user', name: user.name } : null
}
