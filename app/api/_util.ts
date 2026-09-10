import { NextResponse } from 'next/server'
import { resolveCaller, type Caller } from '@/lib/auth'
import { TASK_STRING_MAX, LABEL_MAX, LABEL_COUNT_MAX, LOG_BODY_MAX } from '@/lib/shared'

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** Returns the caller, or a 401 response to return directly. */
export async function requireCaller(req: Request): Promise<Caller | NextResponse> {
  const caller = await resolveCaller(req)
  return caller ?? bad('Unauthorized', 401)
}

// Verified against this Next version (16.3.4) that NextResponse.json()
// really does return `new NextResponse(...)` —
// node_modules/next/dist/server/web/spec-extension/response.js:94-96 —
// and a direct runtime check (`r instanceof NextResponse`) confirmed `true`.
// instanceof is safe here.
export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse

// TASK_STRING_MAX/LABEL_MAX/LABEL_COUNT_MAX/LOG_BODY_MAX live in lib/shared.ts
// (re-exported here for every route in this directory to import from one
// place) so the server actions in app/p/[slug]/actions.ts enforce the exact
// same sizes instead of a second, driftable copy. Enforced here at the
// route, not in lib/db.ts: truncating an over-length write — especially an
// append-only work log entry, which can never be corrected afterward — is
// worse than rejecting it with a 400.
export { TASK_STRING_MAX, LOG_BODY_MAX }

/**
 * Validates body[key], if present, is a string within `max` characters.
 * Returns a 400 response to return directly, or null when the field is
 * absent or valid.
 *
 * Guards every string field a route hands to Appwrite against a non-string
 * JSON value (e.g. a number or object for `title`, which would otherwise
 * throw on `.trim()` and surface as a 500) before any string method is
 * called on it, and against exceeding its declared column size.
 */
export function checkStringField(
  body: Record<string, unknown>, key: string, max: number,
): NextResponse | null {
  if (!(key in body)) return null
  const v = body[key]
  if (typeof v !== 'string') return bad(`${key} must be a string`)
  if (v.length > max) return bad(`${key} must be at most ${max} characters`)
  return null
}

// Found while manually probing trust-boundary behaviour: `labels`/`order` of
// the wrong JSON type reach Appwrite unchecked and its own schema validation
// throws an AppwriteException that propagates as an uncaught 500, not a
// clean 400.

/**
 * Validates body.labels, if present, is an array of at most LABEL_COUNT_MAX
 * strings, each within LABEL_MAX. The count cap isn't an Appwrite column
 * limit — it's enforced here (and identically in the human's Save form) so
 * neither door can write a labels array the other silently can't display or
 * round-trip.
 */
export function checkLabels(body: Record<string, unknown>): NextResponse | null {
  if (!('labels' in body)) return null
  const v = body.labels
  if (!Array.isArray(v)) return bad('labels must be an array of strings')
  if (v.length > LABEL_COUNT_MAX) return bad(`labels must have at most ${LABEL_COUNT_MAX} entries`)
  if (!v.every(s => typeof s === 'string' && s.length <= LABEL_MAX))
    return bad(`labels must be an array of strings, each at most ${LABEL_MAX} characters`)
  return null
}

/** Validates body.order, if present, is a finite number. */
export function checkOrder(body: Record<string, unknown>): NextResponse | null {
  if (!('order' in body)) return null
  if (typeof body.order !== 'number' || !Number.isFinite(body.order))
    return bad('order must be a number')
  return null
}
