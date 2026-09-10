import { cookies } from 'next/headers'
import { createSession, SESSION_COOKIE } from '@/lib/auth'
import { bad, json } from '../_util'

/**
 * The non-browser front door: exchanges email/password for the same session
 * cookie the browser's login form gets from app/login/actions.ts. Any
 * client that isn't a browser (curl, a script, an agent) needs this — a
 * Server Action can only be invoked by a browser form submission.
 *
 * Deliberately reuses lib/auth.ts's createSession() rather than talking to
 * Appwrite directly (Ruling 64): that function owns the exchange, including
 * the empty-secret guard for a keyless client's silent-failure session
 * (see lib/auth.ts's doc comment). A second copy of that guard here would
 * be free to drift from the one that was measured.
 *
 * The cookies().set(...) call below is copied attribute-for-attribute from
 * app/login/actions.ts's login() (Ruling 65) — httpOnly, secure only in
 * production, sameSite: 'lax', path: '/', same expiry source. sameSite:
 * 'lax' is this app's only CSRF defence (see resolveCaller's doc comment in
 * lib/auth.ts); a route that set the cookie differently would silently
 * reopen that hole for every client using this endpoint instead of the
 * browser form.
 *
 * Unauthenticated and internet-reachable by design, with no bespoke rate
 * limiting (Ruling 67) — the same exposure the browser's login form already
 * has, and Appwrite rate-limits its own auth endpoint.
 */
export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || !password) return bad('email and password are required')

  const session = await createSession(email, password)
  if (!session.ok) {
    if (session.reason === 'no_secret') {
      return bad('Login succeeded but no session secret was returned.', 500)
    }
    return bad('Invalid email or password.', 401)
  }

  ;(await cookies()).set(SESSION_COOKIE, session.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expire),
  })
  return json({ ok: true })
}
