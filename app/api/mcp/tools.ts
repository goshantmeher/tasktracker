import {
  listProjects, getProjectBySlug, listTasks, getTask, createTask, updateTask,
  addLog, listLog, recentLogByTask,
  STATUSES, TYPES, PRIORITIES, MD_FIELDS, type TaskInput,
} from '@/lib/db'
import { renderContext } from '@/lib/context.mjs'
import { TASK_STRING_MAX, LABEL_MAX, LABEL_COUNT_MAX, LOG_BODY_MAX } from '@/lib/shared'

/**
 * The tools this tracker exposes over MCP, and the code behind them.
 *
 * Every handler goes through lib/db.ts, the same module the board's Server
 * Actions and the REST routes use — so an agent calling `update_task` and a
 * human dragging a card are still the same write, and none of the validation
 * below is a second implementation of anything: the caps come from
 * lib/shared.ts, which is also where app/api/_util.ts and the Save form get
 * theirs.
 *
 * Deliberately no `delete_task`. Deleting is irreversible, the log goes with
 * it, and it is the one operation a human should have to click. The REST
 * door still has DELETE for scripts that genuinely need it.
 */

export type ToolDef = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<string>
}

/** Thrown by a handler or validator; the dispatcher turns it into a tool error. */
class ToolError extends Error {}

const str = (v: unknown, field: string, max: number, required = false): string | undefined => {
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`${field} is required`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolError(`${field} must be a string`)
  if (v.length > max) throw new ToolError(`${field} must be at most ${max} characters`)
  return v
}

const oneOf = (v: unknown, field: string, allowed: readonly string[]): string | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !allowed.includes(v))
    throw new ToolError(`${field} must be one of: ${allowed.join(', ')}`)
  return v
}

const labels = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new ToolError('labels must be an array of strings')
  if (v.length > LABEL_COUNT_MAX)
    throw new ToolError(`labels must have at most ${LABEL_COUNT_MAX} entries`)
  if (!v.every(s => typeof s === 'string' && s.length <= LABEL_MAX))
    throw new ToolError(`each label must be a string of at most ${LABEL_MAX} characters`)
  return v as string[]
}

/** Resolves a project slug to a project, or explains that it doesn't exist. */
async function project(slug: unknown) {
  const s = str(slug, 'project', 256, true)!
  const p = await getProjectBySlug(s)
  if (!p) {
    const known = (await listProjects()).map(x => x.slug).join(', ')
    throw new ToolError(`no such project: ${s}. Known projects: ${known || '(none)'}`)
  }
  return p
}

/**
 * Builds the writable half of a task from tool arguments. Shared by
 * create_task and update_task so the two can never drift on what a field is
 * called or how large it may be — and returns only the keys actually
 * supplied, which is what keeps update_task a genuine partial update.
 */
function taskPatch(a: Record<string, unknown>): Partial<TaskInput> {
  const patch: Record<string, unknown> = {}
  const put = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v }

  put('title', str(a.title, 'title', TASK_STRING_MAX.title))
  for (const f of MD_FIELDS) put(f, str(a[f], f, TASK_STRING_MAX[f]))
  put('type', oneOf(a.type, 'type', TYPES))
  put('status', oneOf(a.status, 'status', STATUSES))
  put('priority', oneOf(a.priority, 'priority', PRIORITIES))
  put('assignee', str(a.assignee, 'assignee', TASK_STRING_MAX.assignee))
  put('labels', labels(a.labels))
  return patch as Partial<TaskInput>
}

// Reused by both task-writing tools so their schemas describe the same fields
// in the same words the board uses.
const TASK_FIELDS = {
  title: { type: 'string', description: 'One line. What needs doing.' },
  description: { type: 'string', description: 'Markdown. What is this task?' },
  requirement: { type: 'string', description: 'Markdown. What does done look like?' },
  prerequisites: { type: 'string', description: 'Markdown. What must be true before starting?' },
  result: { type: 'string', description: 'Markdown. What actually happened. Write this as you finish.' },
  notes: {
    type: 'string',
    description:
      'Markdown. Caveats to keep in mind while working on OTHER tasks — this is surfaced on every board read, so put anything here that would bite someone working elsewhere in the codebase.',
  },
  type: { type: 'string', enum: [...TYPES] },
  status: { type: 'string', enum: [...STATUSES] },
  priority: { type: 'string', enum: [...PRIORITIES] },
  assignee: { type: 'string', description: 'Free text. Empty means unassigned.' },
  labels: { type: 'array', items: { type: 'string' }, description: `Up to ${LABEL_COUNT_MAX} labels.` },
} as const

const LOG_STATUSES = ['in_progress', 'blocked', 'todo']

export const TOOLS: ToolDef[] = [
  {
    name: 'get_board',
    title: 'Read the whole board',
    description:
      'Start here. Returns the entire board as markdown: caveats to keep in mind first, then open tasks with their descriptions, requirements and recent work log, then finished work. One call gives you the whole picture — prefer it over listing tasks and fetching them one by one.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project slug, e.g. "checkout-revamp".' } },
      required: ['project'],
    },
    handler: async a => {
      const p = await project(a.project)
      // No limit, for the same reason app/api/context/route.ts passes none:
      // an agent catching up on a large board must not silently get a
      // partial one.
      const tasks = await listTasks({ projectId: p.id })
      const logTargets = tasks.filter(t => LOG_STATUSES.includes(t.status))
      const logByTask = await recentLogByTask(logTargets.map(t => t.id))
      return renderContext({ project: p, tasks, logByTask })
    },
  },
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'Every project in the tracker, with the slug that other tools take.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => JSON.stringify(await listProjects(), null, 2),
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'Tasks on one board, optionally filtered. Returns full task objects including every markdown field, so this can be a lot of text — use get_board for an overview and this when you need a specific slice.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug.' },
        status: { type: 'array', items: { type: 'string', enum: [...STATUSES] } },
        type: { type: 'array', items: { type: 'string', enum: [...TYPES] } },
        assignee: { type: 'string' },
        label: { type: 'string', description: 'Return only tasks carrying this label.' },
      },
      required: ['project'],
    },
    handler: async a => {
      const p = await project(a.project)
      const tasks = await listTasks({
        projectId: p.id,
        status: a.status as never,
        type: a.type as never,
        assignee: str(a.assignee, 'assignee', TASK_STRING_MAX.assignee),
        label: str(a.label, 'label', LABEL_MAX),
      })
      return JSON.stringify(tasks, null, 2)
    },
  },
  {
    name: 'get_task',
    title: 'Read one task',
    description: 'One task with all five markdown fields and its full work log.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task id, as returned by list_tasks or shown in the board URL.' } },
      required: ['id'],
    },
    handler: async a => {
      const id = str(a.id, 'id', 64, true)!
      const task = await getTask(id)
      if (!task) throw new ToolError(`no such task: ${id}`)
      return JSON.stringify({ ...task, log: await listLog(id) }, null, 2)
    },
  },
  {
    name: 'create_task',
    title: 'Create a task',
    description: 'Adds a task to the bottom of its column. Only project and title are required.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' }, ...TASK_FIELDS },
      required: ['project', 'title'],
    },
    handler: async a => {
      const p = await project(a.project)
      const patch = taskPatch(a)
      if (!patch.title?.trim()) throw new ToolError('title is required')
      return JSON.stringify(await createTask(p.id, { ...patch, title: patch.title }), null, 2)
    },
  },
  {
    name: 'update_task',
    title: 'Update a task',
    description:
      'Partial update — send only the fields you are changing. Omitted fields are left alone, so writing `result` cannot clobber a `requirement` you never read. Moving a task between columns is just status.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ...TASK_FIELDS },
      required: ['id'],
    },
    handler: async a => {
      const id = str(a.id, 'id', 64, true)!
      if (!(await getTask(id))) throw new ToolError(`no such task: ${id}`)
      const patch = taskPatch(a)
      if (Object.keys(patch).length === 0) throw new ToolError('no fields to update')
      return JSON.stringify(await updateTask(id, patch), null, 2)
    },
  },
  {
    name: 'add_log',
    title: 'Append to the work log',
    description:
      "Append an entry to a task's work log. Append-only: entries are never edited or deleted, and the human sees them in the same activity stream as their colleagues'. Record what you tried and what happened, especially dead ends — that is what stops the next session repeating them.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id.' },
        body: { type: 'string', description: 'Markdown.' },
        author: { type: 'string', description: 'Who is writing. Defaults to "claude".' },
      },
      required: ['id', 'body'],
    },
    handler: async a => {
      const id = str(a.id, 'id', 64, true)!
      if (!(await getTask(id))) throw new ToolError(`no such task: ${id}`)
      const body = str(a.body, 'body', LOG_BODY_MAX, true)!
      if (!body.trim()) throw new ToolError('body is required')
      const author = str(a.author, 'author', TASK_STRING_MAX.assignee) || 'claude'
      return JSON.stringify(await addLog(id, author, body), null, 2)
    },
  },
]

/** The `tools/list` payload — the handler is ours, not the client's business. */
export const TOOL_MANIFEST = TOOLS.map(({ name, title, description, inputSchema }) => ({
  name, title, description, inputSchema,
}))

/**
 * Runs one tool. A failure comes back as tool content with `isError`, not a
 * JSON-RPC error: the MCP spec reserves protocol errors for the protocol, and
 * a model that gets "no such project: foo. Known projects: bar" in its
 * transcript can correct itself, where a transport-level error is invisible
 * to it.
 */
export async function callTool(name: unknown, args: unknown) {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) {
    return {
      content: [{ type: 'text', text: `no such tool: ${String(name)}` }],
      isError: true,
    }
  }
  try {
    const text = await tool.handler((args ?? {}) as Record<string, unknown>)
    return { content: [{ type: 'text', text }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: e instanceof Error ? e.message : 'tool failed' }],
      isError: true,
    }
  }
}
