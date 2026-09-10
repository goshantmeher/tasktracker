import { requireCaller, isResponse, json, bad, checkStringField, LOG_BODY_MAX } from '../../../_util'
import { getTask, addLog, listLog } from '@/lib/db'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const { id } = await ctx.params
  if (!(await getTask(id))) return bad('no such task', 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')

  const lenErr = checkStringField(body, 'body', LOG_BODY_MAX)
  if (lenErr) return lenErr
  if (typeof body.body !== 'string' || !body.body.trim()) return bad('body is required')

  // Author is always the authenticated caller — the key's label, or the
  // user's name — and is deliberately not client-settable (Ruling 59): the
  // work log is append-only with no correction path, so a forged author
  // would be permanent, and `author` is the one field the UI renders as
  // authoritative provenance. Any `body.author` in the request is ignored.
  const entry = await addLog(id, caller.name, body.body)
  return json(entry, 201)
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  const { id } = await ctx.params
  // Ruling 62: an empty array for a nonexistent task is indistinguishable
  // from a real task with no history — the same swallow-absence-as-data
  // defect this codebase already fixed once in getTask. This endpoint's
  // entire audience is an agent that cannot tell the two apart, so 404
  // instead of overriding the brief's reference code, which never checked.
  if (!(await getTask(id))) return bad('no such task', 404)
  return json({ entries: await listLog(id) })
}
