import { createSession, setSessionCookie } from '@/lib/auth'
import { bad, json } from '../_util'

/**
 * The non-browser front door: exchanges email/password for the same session
 * cookie the browser's login form gets from app/login/actions.ts. Any
 * client that isn't a browser (curl, a script, an agent) needs this — a
 * Server Action can only be invoked by a browser form submission.
 *
 * Deliberately reuses lib/auth.ts's createSession() rather than talking to
 * Appwrite directly: that function owns the exchange, including the
 * empty-secret guard for a keyless client's silent-failure session (see
 * lib/auth.ts's doc comment). A second copy of that guard here would be
 * free to drift from the one that was measured.
 *
 * The cookie is written by lib/auth.ts's setSessionCookie(), the single
 * place both front doors go through, so this route's attributes cannot
 * drift from the browser form's. sameSite: 'lax' is this app's only CSRF
 * defence — see that function's doc comment.
 *
 * Unauthenticated and internet-reachable by design, with no bespoke rate
 * limiting — the same exposure the browser's login form already has, and
 * Appwrite rate-limits its own auth endpoint.
 *
 * Accepts either a JSON body or a form-urlencoded one: every other route in
 * this API takes JSON and every README example does too, but a plain
 * `<form>` POST (form-urlencoded) must also work since that's what a
 * browser would send. `req.formData()` throws a TypeError on a JSON body
 * with no bespoke handling — every other route in this API 400s cleanly on
 * a body it can't parse; this is the one route that didn't, and it's the
 * route built specifically for non-browser callers most likely to send
 * JSON on the first try.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? ''
  let email: string, password: string
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('body must be JSON or form-encoded (email, password)')
    email = String((body as Record<string, unknown>).email ?? '')
    password = String((body as Record<string, unknown>).password ?? '')
  } else {
    const form = await req.formData().catch(() => null)
    if (!form) return bad('body must be JSON or form-encoded (email, password)')
    email = String(form.get('email') ?? '')
    password = String(form.get('password') ?? '')
  }
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
