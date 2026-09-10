import { requireCaller, isResponse, json, bad, checkStringField, TASK_STRING_MAX, checkLabels, checkOrder } from '../_util'
import {
  getProjectBySlug, listTasks, createTask,
  STATUSES, TYPES, PRIORITIES, type Status,
} from '@/lib/db'

const csv = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined)

export async function GET(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const url = new URL(req.url)
  const slug = url.searchParams.get('project')
  if (!slug) return bad('project is required')
  const project = await getProjectBySlug(slug)
  if (!project) return bad(`no such project: ${slug}`, 404)

  const status = csv(url.searchParams.get('status'))
  if (status?.some(s => !(STATUSES as readonly string[]).includes(s)))
    return bad(`status must be one of: ${STATUSES.join(', ')}`)
  const type = csv(url.searchParams.get('type'))
  if (type?.some(t => !(TYPES as readonly string[]).includes(t)))
    return bad(`type must be one of: ${TYPES.join(', ')}`)

  // Pass `limit` through when the caller gave one, otherwise omit it
  // entirely so lib/db.ts's DEFAULT_LIST_LIMIT (5000) applies. A hardcoded
  // `Number(...) || 100` here is the exact silent-truncation bug already
  // fixed once in listTasks — an agent reading a large board must not get a
  // silently short list back.
  const limitParam = url.searchParams.get('limit')
  let limit: number | undefined
  if (limitParam !== null) {
    limit = Number(limitParam)
    if (!Number.isFinite(limit) || limit <= 0) return bad('limit must be a positive number')
  }

  const tasks = await listTasks({
    projectId: project.id,
    status: status as Status[] | undefined,
    type,
    assignee: url.searchParams.get('assignee') ?? undefined,
    label: url.searchParams.get('label') ?? undefined,
    limit,
  })
  return json({ tasks })
}

export async function POST(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')
  if (typeof body.project !== 'string' || !body.project) return bad('project is required')

  for (const [key, max] of Object.entries(TASK_STRING_MAX)) {
    const err = checkStringField(body, key, max)
    if (err) return err
  }
  const labelsErr = checkLabels(body)
  if (labelsErr) return labelsErr
  const orderErr = checkOrder(body)
  if (orderErr) return orderErr
  if (typeof body.title !== 'string' || !body.title.trim()) return bad('title is required')

  const project = await getProjectBySlug(body.project)
  if (!project) return bad(`no such project: ${body.project}`, 404)

  for (const [field, allowed] of [
    ['status', STATUSES], ['type', TYPES], ['priority', PRIORITIES],
  ] as const) {
    // Presence, not truthiness: `field in body` catches `status: ""` (and
    // `null`), which `body[field] &&` would let through — falsy skips the
    // check, then the empty string reaches Appwrite's enum write as an
    // uncaught 500 instead of a 400. A caller who sent the key deserves an
    // answer about it, even if the value they sent is the empty string.
    if (field in body && !(allowed as readonly string[]).includes(body[field]))
      return bad(`${field} must be one of: ${allowed.join(', ')}`)
  }

  const task = await createTask(project.id, body)
  return json(task, 201)
}
