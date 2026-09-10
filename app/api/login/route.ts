import { createSession, setSessionCookie } from '@/lib/auth'
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
 * The cookie is written by lib/auth.ts's setSessionCookie(), the single
 * place both front doors go through (Ruling 65), so this route's attributes
 * cannot drift from the browser form's. sameSite: 'lax' is this app's only
 * CSRF defence — see that function's doc comment.
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

  await setSessionCookie(session.secret, session.expire)
  return json({ ok: true })
}
