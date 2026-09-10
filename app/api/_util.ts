import { NextResponse } from 'next/server'
import { resolveCaller, type Caller } from '@/lib/auth'

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** Returns the caller, or a 401 response to return directly. */
export async function requireCaller(req: Request): Promise<Caller | NextResponse> {
  const caller = await resolveCaller(req)
  return caller ?? bad('Unauthorized', 401)
}

// Ruling 51: verified against this Next version (16.3.4) that
// NextResponse.json() really does return `new NextResponse(...)` —
// node_modules/next/dist/server/web/spec-extension/response.js:94-96 —
// and a direct runtime check (`r instanceof NextResponse`) confirmed `true`
// (see task-9-report.md for the real output). instanceof is safe here.
export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse

// Declared Appwrite attribute sizes, read from scripts/setup-appwrite.mjs —
// not guessed. Enforced here at the route, not in lib/db.ts (Ruling 54):
// truncating an over-length write — especially an append-only work log
// entry, which can never be corrected afterward — is worse than rejecting
// it with a 400.
export const TASK_STRING_MAX: Record<string, number> = {
  title: 256,
  assignee: 64,
  description: 65535,
  requirement: 65535,
  prerequisites: 65535,
  result: 65535,
  notes: 65535,
}
export const LOG_BODY_MAX = 65535

/**
 * Validates body[key], if present, is a string within `max` characters.
 * Returns a 400 response to return directly, or null when the field is
 * absent or valid.
 *
 * Guards every string field a route hands to Appwrite against a non-string
 * JSON value (Ruling 52 — e.g. a number or object for `title`, which would
 * otherwise throw on `.trim()` and surface as a 500) before any string
 * method is called on it, and against exceeding its declared column size
 * (Ruling 54).
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

// Found while manually probing trust-boundary behaviour, not named by any
// ruling directly, but the same class of bug: `labels`/`order` of the wrong
// JSON type reach Appwrite unchecked and its own schema validation throws an
// AppwriteException that propagates as an uncaught 500, not a clean 400.
// Confirmed with real requests — see task-9-report.md.
const LABEL_MAX = 64 // scripts/setup-appwrite.mjs: tasks.labels, string array, size 64

/** Validates body.labels, if present, is an array of strings each within LABEL_MAX. */
export function checkLabels(body: Record<string, unknown>): NextResponse | null {
  if (!('labels' in body)) return null
  const v = body.labels
  if (!Array.isArray(v) || !v.every(s => typeof s === 'string' && s.length <= LABEL_MAX))
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
