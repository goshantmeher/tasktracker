import { requireCaller, isResponse, json, bad } from '../../../_util'
import { getTask, addChecklistItems } from '@/lib/db'
import { checklistText, LimitError } from '@/lib/shared'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const task = await getTask((await ctx.params).id)
  if (!task) return bad('no such task', 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')

  try {
    const [item] = await addChecklistItems(task, [checklistText(body.text)])
    return json(item, 201)
  } catch (e) {
    // The caller's mistake is a 400; anything else (Appwrite down) stays a 500.
    if (e instanceof LimitError) return bad(e.message)
    throw e
  }
}
