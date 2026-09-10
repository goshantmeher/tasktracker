import { requireCaller, isResponse, json, bad, checkStringField, TASK_STRING_MAX, checkLabels, checkOrder } from '../../_util'
import { getTask, updateTask, STATUSES, TYPES, PRIORITIES, MD_FIELDS, type TaskInput } from '@/lib/db'

const WRITABLE = [
  'title', ...MD_FIELDS, 'type', 'status', 'priority', 'assignee', 'labels', 'order',
] as const

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const { id } = await ctx.params
  if (!(await getTask(id))) return bad('no such task', 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')

  for (const [key, max] of Object.entries(TASK_STRING_MAX)) {
    const err = checkStringField(body, key, max)
    if (err) return err
  }
  const labelsErr = checkLabels(body)
  if (labelsErr) return labelsErr
  const orderErr = checkOrder(body)
  if (orderErr) return orderErr

  for (const [field, allowed] of [
    ['status', STATUSES], ['type', TYPES], ['priority', PRIORITIES],
  ] as const) {
    if (body[field] && !(allowed as readonly string[]).includes(body[field]))
      return bad(`${field} must be one of: ${allowed.join(', ')}`)
  }

  // Whitelist. Anything not writable — projectId above all — is dropped silently.
  const patch: Partial<TaskInput> = {}
  for (const k of WRITABLE) if (k in body) (patch as Record<string, unknown>)[k] = body[k]
  if (Object.keys(patch).length === 0) return bad('no writable fields in body')

  return json(await updateTask(id, patch))
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  const task = await getTask((await ctx.params).id)
  return task ? json(task) : bad('no such task', 404)
}
