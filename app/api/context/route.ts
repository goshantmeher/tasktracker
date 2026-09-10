import { requireCaller, isResponse, bad } from '../_util'
import { getProjectBySlug, listTasks, recentLogByTask } from '@/lib/db'
import { renderContext } from '@/lib/context.mjs'

// Statuses worth fetching work-log entries for. Ruling 61: recentLogByTask
// issues one query per task id, in parallel, and its own doc comment says a
// caller must bound the set rather than pass an unbounded list — the brief
// passes every non-done task, which on a large board is an unbounded
// fan-out. Backlog is excluded: it's the bulk of a large board and almost
// never carries log entries, so dropping it bounds the fan-out and also
// cuts log chatter that would just be noise under a not-yet-started task.
// Remaining ceiling: still one query per in_progress/blocked/todo task
// (realistically tens on one board) — move to a single batched query with
// per-task windowing if that group itself ever needs to scale further.
const LOG_STATUSES = ['in_progress', 'blocked', 'todo']

export async function GET(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const slug = new URL(req.url).searchParams.get('project')
  if (!slug) return bad('project is required')
  const project = await getProjectBySlug(slug)
  if (!project) return bad(`no such project: ${slug}`, 404)

  // Ruling 50: no `limit` here — lib/db.ts's DEFAULT_LIST_LIMIT applies. A
  // hardcoded limit is the exact silent-truncation bug already fixed once in
  // listTasks; an agent catching up on a large board must not silently get
  // back a partial one.
  const tasks = await listTasks({ projectId: project.id })

  const logTargets = tasks.filter(t => (LOG_STATUSES as readonly string[]).includes(t.status))
  const logByTask = await recentLogByTask(logTargets.map(t => t.id))

  return new Response(renderContext({ project, tasks, logByTask }), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  })
}
