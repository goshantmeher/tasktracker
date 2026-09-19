import { requireCaller, isResponse, json, bad, checkOrder } from '../../../../_util'
import { getChecklistItem, updateChecklistItem, deleteChecklistItem } from '@/lib/db'
import { checklistText, LimitError, type ChecklistItem } from '@/lib/shared'

type Ctx = { params: Promise<{ id: string; itemId: string }> }

/**
 * The item, only if it belongs to the task in the URL. Without this an item
 * id alone would reach any task's checklist through any other task's path.
 */
async function ownedItem(ctx: Ctx) {
  const { id, itemId } = await ctx.params
  const item = await getChecklistItem(itemId)
  return item && item.taskId === id ? item : null
}

export async function PATCH(req: Request, ctx: Ctx) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const item = await ownedItem(ctx)
  if (!item) return bad('no such checklist item on this task', 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')

  const patch: Partial<Pick<ChecklistItem, 'text' | 'done' | 'order'>> = {}
  if ('text' in body) {
    try { patch.text = checklistText(body.text) } catch (e) {
      if (e instanceof LimitError) return bad(e.message)
      throw e
    }
  }
  if ('done' in body) {
    if (typeof body.done !== 'boolean') return bad('done must be a boolean')
    patch.done = body.done
  }
  const orderErr = checkOrder(body)
  if (orderErr) return orderErr
  if ('order' in body) patch.order = body.order
  // Whitelist, like the task PATCH: taskId/projectId are never writable.
  if (Object.keys(patch).length === 0) return bad('no writable fields in body')

  return json(await updateChecklistItem(item.id, patch))
}

export async function DELETE(req: Request, ctx: Ctx) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const item = await ownedItem(ctx)
  if (!item) return bad('no such checklist item on this task', 404)
  await deleteChecklistItem(item.id)
  return json({ deleted: item.id })
}
