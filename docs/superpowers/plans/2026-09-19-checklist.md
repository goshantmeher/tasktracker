# Task Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-task checklist (text + done items) that a human ticks off on the task page and an agent ticks off over MCP or REST, with progress shown on the kanban card.

**Architecture:** A new Appwrite collection `checklist`, one document per item, read and written only through new functions in `lib/db.ts`. Every entry point — MCP tools, REST routes, server actions — validates with the same helper from `lib/shared.ts` and calls the same `lib/db.ts` functions. The detail page gets a `Checklist` client component; the board gets per-task progress from one extra query per page load.

**Tech Stack:** Next.js 16.3.4 (App Router, server actions, route handlers), React 19, node-appwrite 29 (`Databases` API), Tailwind 4, `node:test` + live probes run with `node --import tsx`.

**Spec:** `docs/superpowers/specs/2026-09-19-checklist-design.md`

## Global Constraints

- **Never touch the `deepfront` project** — not its tasks, not as a probe target. Every write in every test goes to the `scratch` project only.
- **Back up before the first write of each session:** `node --import tsx scripts/backup.mjs`.
- **Read the Next docs before writing Next code:** `node_modules/next/dist/docs/01-app/` (this Next version differs from training data — see `AGENTS.md`). Relevant: server actions / `revalidatePath`, route handlers with `params: Promise<...>`.
- Limits, verbatim: `CHECKLIST_TEXT_MAX = 512`, `CHECKLIST_COUNT_MAX = 100`.
- Item text is trimmed; blank text is rejected.
- Validation at the trust boundary is phase 1, not phase 2. Within each task, build and prove the happy path first, then the negative checks.
- Every id that reaches an Appwrite path goes through `docId` in `lib/db.ts`. Never call Appwrite's bulk `deleteDocuments` — delete items one by one.
- Match the surrounding code: comment the *why*, keep helpers small, no new dependencies.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DqkLacnWuRRPyXE7TRWZsV
  ```

## File Map

| File | Change |
|---|---|
| `lib/shared.ts` | `ChecklistItem`, `ChecklistProgress`, limits, `LimitError`, `checklistText()` |
| `lib/db.ts` | checklist CRUD, `checklistProgress`, `deleteTask` clears items |
| `scripts/setup-appwrite.mjs` | create `checklist` collection + indexes |
| `scripts/backup.mjs` | dump/restore `checklist`; restore tolerates older backups without it |
| `test/shared.test.mts` | unit test for `checklistText` |
| `test/checklist-probe.mts` | **new** — live probe of db + MCP against `scratch` |
| `app/api/mcp/tools.ts` | `get_task` + checklist, `create_task` `checklist`, new `update_checklist` |
| `app/api/tasks/[id]/route.ts` | GET includes checklist |
| `app/api/tasks/[id]/checklist/route.ts` | **new** — POST |
| `app/api/tasks/[id]/checklist/[itemId]/route.ts` | **new** — PATCH, DELETE |
| `test/api-contract.mjs` | checklist section |
| `app/p/[slug]/actions.ts` | four checklist server actions |
| `app/p/[slug]/t/[id]/checklist.tsx` | **new** — `Checklist` client component |
| `app/p/[slug]/t/[id]/page.tsx` | fetch items, render `Checklist` after Description |
| `app/p/[slug]/page.tsx` | fetch progress |
| `app/p/[slug]/board.tsx` | `progress` prop, `ChecklistBar` on cards |

---

### Task 1: Data layer — schema, shared helpers, db functions

**Files:**
- Modify: `lib/shared.ts` (append)
- Modify: `lib/db.ts` (imports at top; `deleteTask` ~line 265; new section after the worklog section)
- Modify: `scripts/setup-appwrite.mjs` (before `console.log('\nschema ready')`)
- Modify: `scripts/backup.mjs:26` and the restore loop
- Test: `test/shared.test.mts`, create `test/checklist-probe.mts`

**Interfaces:**
- Produces (lib/shared.ts):
  - `type ChecklistItem = { id: string; taskId: string; text: string; done: boolean; order: number }`
  - `type ChecklistProgress = { done: number; total: number }`
  - `CHECKLIST_TEXT_MAX = 512`, `CHECKLIST_COUNT_MAX = 100`
  - `class LimitError extends Error`
  - `checklistText(v: unknown): string` — trimmed text or throws `LimitError`
- Produces (lib/db.ts):
  - `listChecklist(taskId: string): Promise<ChecklistItem[]>` — ordered by `order`
  - `getChecklistItem(id: string): Promise<ChecklistItem | null>`
  - `addChecklistItems(task: { id: string; projectId: string }, texts: string[]): Promise<ChecklistItem[]>` — appends at bottom; throws `LimitError` past 100
  - `updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, 'text' | 'done' | 'order'>>): Promise<ChecklistItem>`
  - `deleteChecklistItem(id: string): Promise<void>`
  - `deleteChecklist(taskId: string): Promise<void>`
  - `checklistProgress(projectId: string): Promise<Record<string, ChecklistProgress>>` — only tasks that have items
  - `deleteTask(id)` now deletes the task's items first

- [ ] **Step 1: Back up the live data**

Run: `node --import tsx scripts/backup.mjs`
Expected: `backed up to backups/<timestamp>`

- [ ] **Step 2: Write the failing unit test** — append to `test/shared.test.mts`, and add `checklistText, LimitError, CHECKLIST_TEXT_MAX` to its import from `'../lib/shared'`:

```ts
// The one validator every door (MCP, REST, server actions) runs item text
// through, so they cannot disagree on what a valid item is.
test('checklistText: trims and accepts ordinary text', () => {
  assert.equal(checklistText('  write the test  '), 'write the test')
})

test('checklistText: refuses blank, non-string and over-length text', () => {
  assert.throws(() => checklistText('   '), LimitError)
  assert.throws(() => checklistText(42), LimitError)
  assert.throws(() => checklistText(undefined), LimitError)
  assert.throws(() => checklistText('x'.repeat(CHECKLIST_TEXT_MAX + 1)), LimitError)
  assert.equal(checklistText('x'.repeat(CHECKLIST_TEXT_MAX)).length, CHECKLIST_TEXT_MAX)
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --import tsx --test test/shared.test.mts`
Expected: FAIL — `checklistText` is not exported.

- [ ] **Step 4: Add the shared helpers** — append to `lib/shared.ts`:

```ts
export type ChecklistItem = { id: string; taskId: string; text: string; done: boolean; order: number }
export type ChecklistProgress = { done: number; total: number }

// checklist.text's declared column size (scripts/setup-appwrite.mjs), and an
// app-level cap on items per task so the list stays usable. Enforced the
// same on every door.
export const CHECKLIST_TEXT_MAX = 512
export const CHECKLIST_COUNT_MAX = 100

/**
 * A limit the caller broke, as opposed to something going wrong. The REST
 * door turns it into a 400 and lets every other error stay a 500, so an
 * Appwrite outage is never reported as the caller's fault.
 */
export class LimitError extends Error {}

/** Item text, trimmed — or a LimitError saying why it can't be one. */
export function checklistText(v: unknown): string {
  if (typeof v !== 'string') throw new LimitError('checklist item text must be a string')
  const t = v.trim()
  if (!t) throw new LimitError('checklist item text is required')
  if (t.length > CHECKLIST_TEXT_MAX)
    throw new LimitError(`checklist item text must be at most ${CHECKLIST_TEXT_MAX} characters`)
  return t
}
```

- [ ] **Step 5: Run the unit test**

Run: `node --import tsx --test test/shared.test.mts`
Expected: PASS

- [ ] **Step 6: Write the failing live probe** — create `test/checklist-probe.mts`:

```ts
// The checklist, run against live Appwrite: lib/db.ts first, then (Task 2)
// the MCP tools through the real dispatcher.
//
// Run with: node --import tsx test/checklist-probe.mts
//
// Writes only to the `scratch` project and deletes everything it created.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}

const {
  getProjectBySlug, createProject, createTask, deleteTask,
  listChecklist, getChecklistItem, addChecklistItems, updateChecklistItem,
  deleteChecklistItem, checklistProgress,
} = await import('../lib/db')
const { LimitError } = await import('../lib/shared')
const { orderBetween } = await import('../lib/order.mjs')

const project = (await getProjectBySlug('scratch')) ?? (await createProject('Scratch'))
assert.equal(project.slug, 'scratch', 'this probe writes to scratch and nowhere else')

const ok = (label: string, cond: unknown) => {
  assert.ok(cond, label)
  console.log('  ✓', label)
}
const texts = async (taskId: string) => (await listChecklist(taskId)).map(i => i.text).join()

const created: string[] = []

try {
  // --- db: happy path -------------------------------------------------------
  const task = await createTask(project.id, { title: 'probe: checklist' })
  created.push(task.id)

  const [a, b, c] = await addChecklistItems(task, ['one', 'two', 'three'])
  ok('items come back in the order they were added', (await texts(task.id)) === 'one,two,three')
  ok('a new item starts not done', !a.done && a.taskId === task.id)

  await updateChecklistItem(b.id, { done: true })
  const after = await listChecklist(task.id)
  ok('ticking writes only that item',
    after.find(i => i.id === b.id)!.done && !after.find(i => i.id === a.id)!.done)

  ok('progress counts done and total for the project',
    JSON.stringify((await checklistProgress(project.id))[task.id]) === '{"done":1,"total":3}')

  await updateChecklistItem(c.id, { order: orderBetween(null, a.order) })
  ok('an order write moves an item', (await texts(task.id)) === 'three,one,two')

  await updateChecklistItem(a.id, { text: 'one, renamed' })
  ok('a text write renames an item', (await texts(task.id)) === 'three,one, renamed,two')

  await deleteChecklistItem(a.id)
  ok('deleting an item removes only that item', (await texts(task.id)) === 'three,two')

  // --- db: limits and cleanup -----------------------------------------------
  await assert.rejects(() => addChecklistItems(task, Array(99).fill('x')), LimitError)
  ok('the 101st item is refused and none of the batch is written', (await listChecklist(task.id)).length === 2)

  const ids = (await listChecklist(task.id)).map(i => i.id)
  await deleteTask(task.id)
  created.splice(created.indexOf(task.id), 1)
  ok('deleting a task deletes its items',
    (await Promise.all(ids.map(getChecklistItem))).every(i => i === null))
} finally {
  for (const id of created) {
    try { await deleteTask(id) } catch (e) { console.error('  ! cleanup failed for', id, e) }
  }
}

console.log('\nall checklist checks passed')
```

- [ ] **Step 7: Run it to see it fail**

Run: `node --import tsx test/checklist-probe.mts`
Expected: FAIL — `addChecklistItems is not a function` (or a TypeScript import error naming it).

- [ ] **Step 8: Create the collection** — in `scripts/setup-appwrite.mjs`, insert before `console.log('\nschema ready')`:

```js
await ok('checklist', () => db.createCollection(DB, 'checklist', 'checklist'))
await ok('checklist.taskId', () => db.createStringAttribute(DB, 'checklist', 'taskId', 36, true))
// Copied from the task so the board can read every item of a project in one
// query instead of one per card.
await ok('checklist.projectId', () => db.createStringAttribute(DB, 'checklist', 'projectId', 36, true))
await ok('checklist.text', () => db.createStringAttribute(DB, 'checklist', 'text', 512, true))
await ok('checklist.done', () => db.createBooleanAttribute(DB, 'checklist', 'done', false, false))
await ok('checklist.order', () => db.createFloatAttribute(DB, 'checklist', 'order', true))
await settle('checklist')
await ok('checklist/by_task', () => db.createIndex(DB, 'checklist', 'by_task', 'key', ['taskId', 'order']))
await ok('checklist/by_project', () => db.createIndex(DB, 'checklist', 'by_project', 'key', ['projectId']))
```

Run: `npm run setup`
Expected: `exists` for every existing resource, `created checklist…` for the nine new lines, then `schema ready`.

- [ ] **Step 9: Add the db functions** — in `lib/db.ts`:

Extend the `./shared` import on line 5 to:

```ts
import {
  STATUSES, DEFAULT_LABEL, CHECKLIST_COUNT_MAX, LimitError,
  type Status, type Task, type TaskInput, type Project, type LogEntry,
  type ChecklistItem, type ChecklistProgress,
} from './shared'
```

Add `ChecklistItem, ChecklistProgress` to the `export type { ... } from './shared'` re-export line.

Replace `deleteTask` with:

```ts
// A real delete, reachable from both front doors (DELETE /api/tasks/:id and
// the detail page's Delete button). The worklog is append-only *per task* —
// nothing edits an entry — but a deleted task's entries are unreachable
// garbage, so both callers clear them first via deleteLog. Checklist items
// are cleared here instead, so no caller (the contract suite's cleanup
// included) can forget them.
export async function deleteTask(id: string): Promise<void> {
  await deleteChecklist(id)
  await db().deleteDocument(DB, 'tasks', docId(id))
}
```

Add a new section after `deleteLog`:

```ts
// --- checklist ---------------------------------------------------------------
// One document per item, not an array on the task: a tick is a write to one
// item, so a human and an agent ticking different items at once both land.

const toItem = (d: Models.DefaultDocument): ChecklistItem => ({
  id: d.$id,
  taskId: d.taskId as string,
  text: d.text as string,
  done: Boolean(d.done),
  order: d.order as number,
})

export async function listChecklist(taskId: string): Promise<ChecklistItem[]> {
  return listDocs('checklist', [
    Query.equal('taskId', docId(taskId)),
    Query.orderAsc('order'),
    Query.limit(DEFAULT_LIST_LIMIT),
  ], toItem)
}

export async function getChecklistItem(id: string): Promise<ChecklistItem | null> {
  return docById('checklist', id, toItem)
}

/**
 * Appends at the bottom, in the order given. The whole batch is refused
 * before anything is written if it would take the list past the cap.
 * ponytail: the count is read, then written — two writers adding at the same
 * moment can land a few items past the cap. Harmless at this scale; a
 * counter on the task would close it.
 */
export async function addChecklistItems(
  task: { id: string; projectId: string }, texts: string[],
): Promise<ChecklistItem[]> {
  const items = await listChecklist(task.id)
  if (items.length + texts.length > CHECKLIST_COUNT_MAX)
    throw new LimitError(
      `a checklist holds at most ${CHECKLIST_COUNT_MAX} items (this one has ${items.length})`)
  let order: number | null = items.length ? items[items.length - 1].order : null
  const added: ChecklistItem[] = []
  for (const text of texts) {
    order = orderBetween(order, null)
    added.push(await insertDoc('checklist',
      { taskId: task.id, projectId: task.projectId, text, done: false, order }, toItem))
  }
  return added
}

/** Partial, like updateTask: only the keys present are sent. */
export async function updateChecklistItem(
  id: string, patch: Partial<Pick<ChecklistItem, 'text' | 'done' | 'order'>>,
): Promise<ChecklistItem> {
  const body: Record<string, unknown> = {}
  for (const k of ['text', 'done', 'order'] as const) if (k in patch) body[k] = patch[k]
  return patchDoc('checklist', id, body, toItem)
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await db().deleteDocument(DB, 'checklist', docId(id))
}

/** One by one, never Appwrite's bulk delete — see docId for why. */
export async function deleteChecklist(taskId: string): Promise<void> {
  for (const item of await listChecklist(taskId)) await deleteChecklistItem(item.id)
}

/**
 * Done/total per task for a whole board, from one query that reads two
 * small fields. Tasks without a checklist are simply absent.
 */
export async function checklistProgress(projectId: string): Promise<Record<string, ChecklistProgress>> {
  const res = await db().listDocuments(DB, 'checklist', [
    Query.equal('projectId', docId(projectId)),
    Query.select(['taskId', 'done']),
    Query.limit(DEFAULT_LIST_LIMIT),
  ])
  const out: Record<string, ChecklistProgress> = {}
  for (const d of res.documents) {
    const p = (out[d.taskId as string] ??= { done: 0, total: 0 })
    p.total++
    if (d.done) p.done++
  }
  return out
}
```

- [ ] **Step 10: Back up the new collection too** — in `scripts/backup.mjs`:

Change line 26 to:

```js
const COLLECTIONS = ['projects', 'tasks', 'worklog', 'api_keys', 'checklist']
```

Change the `readFileSync` import line to `import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'`, and at the top of the restore loop body (right after `for (const c of COLLECTIONS) {` in the `restore` branch) add:

```js
    // Backups taken before a collection existed simply don't have its file.
    if (!existsSync(`${dir}/${c}.json`)) { console.log(`${c}: not in this backup, skipped`); continue }
```

- [ ] **Step 11: Run the probe and the unit tests**

Run: `node --import tsx test/checklist-probe.mts && node --import tsx --test test/*.test.mjs test/*.test.mts`
Expected: every `✓` line, `all checklist checks passed`, and all unit tests pass.

Run: `node --import tsx scripts/backup.mjs`
Expected: includes a `checklist: 0 documents` line.

- [ ] **Step 12: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/shared.ts lib/db.ts scripts/setup-appwrite.mjs scripts/backup.mjs test/shared.test.mts test/checklist-probe.mts
git commit -m "feat: store a checklist per task"   # plus the two trailer lines
```

---

### Task 2: MCP — read the checklist, create with one, change it in a batch

**Files:**
- Modify: `app/api/mcp/tools.ts` (imports; new helpers after `labels`; `get_task`; `create_task`; new tool after `update_task`)
- Modify: `app/api/mcp/route.ts:60` (server instructions)
- Test: `test/checklist-probe.mts`

**Interfaces:**
- Consumes: `listChecklist`, `addChecklistItems`, `updateChecklistItem`, `deleteChecklistItem` from Task 1; `checklistText`, `CHECKLIST_COUNT_MAX` from `lib/shared`.
- Produces (tool contracts):
  - `get_task` → `{ ...task, checklist: [{ id, text, done }], log }`
  - `create_task` accepts `checklist?: string[]`; result gains `checklist: <count>` when given
  - `update_checklist({ id, add?, check?, uncheck?, remove? })` → `{ ok, id, done, total, added: string[] }`

- [ ] **Step 1: Write the failing probe section** — in `test/checklist-probe.mts`:

Add after the `orderBetween` import:

```ts
const { callTool } = await import('../app/api/mcp/tools')

/** One tool call, unwrapped: parsed JSON, or the error text. */
async function call(name: string, args: Record<string, unknown>) {
  const res = await callTool(name, args)
  const text = (res.content[0] as { text: string }).text
  if (res.isError) return { error: text, value: undefined }
  return { value: JSON.parse(text), error: undefined }
}
```

Add inside the `try`, after the db section:

```ts
  // --- MCP: happy path ------------------------------------------------------
  const made = await call('create_task', {
    project: 'scratch', title: 'probe: checklist over MCP', checklist: ['plan', 'build', 'ship'],
  })
  assert.ok(!made.error, `create_task failed: ${made.error}`)
  created.push(made.value.id)
  ok('create_task reports how many items it created', made.value.checklist === 3)

  const got = await call('get_task', { id: made.value.id })
  ok('get_task returns the checklist in order, as id/text/done only',
    got.value.checklist.map((i: { text: string }) => i.text).join() === 'plan,build,ship'
    && Object.keys(got.value.checklist[0]).join() === 'id,text,done')

  const [plan, build, ship] = got.value.checklist
  const batch = await call('update_checklist', {
    id: made.value.id, check: [plan.id, build.id], remove: [ship.id], add: ['verify'],
  })
  ok('update_checklist applies a batch and answers with counts, not the list',
    batch.value.done === 2 && batch.value.total === 3 && batch.value.added.length === 1
    && !JSON.stringify(batch.value).includes('plan'))

  const undone = await call('update_checklist', { id: made.value.id, uncheck: [plan.id] })
  ok('uncheck clears done', undone.value.done === 1)

  // --- MCP: refusals --------------------------------------------------------
  const stray = await call('update_checklist', { id: made.value.id, check: ['not-an-item'] })
  ok('an id that is not an item of this task is refused', stray.error?.includes('not items of task'))

  const blank = await call('update_checklist', { id: made.value.id, add: ['   '] })
  ok('blank item text is refused', blank.error?.includes('required'))

  const empty = await call('update_checklist', { id: made.value.id })
  ok('a call that changes nothing is refused', empty.error?.includes('nothing to change'))

  const full = await call('update_checklist', { id: made.value.id, add: Array(98).fill('x') })
  ok('going past 100 items is refused before anything is written',
    full.error?.includes('at most 100') && (await listChecklist(made.value.id)).length === 3)

  const badCreate = await call('create_task', {
    project: 'scratch', title: 'probe: must not exist', checklist: ['ok', 'y'.repeat(513)],
  })
  ok('create_task with a bad item fails before creating the task',
    badCreate.error?.includes('at most 512'))
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx test/checklist-probe.mts`
Expected: the db section passes, then FAIL at `create_task reports how many items it created`.

- [ ] **Step 3: Implement** — in `app/api/mcp/tools.ts`:

Add to the `@/lib/db` import: `listChecklist, addChecklistItems, updateChecklistItem, deleteChecklistItem`.
Add to the `@/lib/shared` import: `checklistText, CHECKLIST_COUNT_MAX`.

After the `labels` validator, add:

```ts
/** Item texts off the wire, all validated before anything is written. */
const itemTexts = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new ToolError(`${field} must be an array of strings`)
  if (v.length > CHECKLIST_COUNT_MAX)
    throw new ToolError(`${field} must have at most ${CHECKLIST_COUNT_MAX} entries`)
  return v.map(checklistText)
}

const itemIds = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every(s => typeof s === 'string'))
    throw new ToolError(`${field} must be an array of item ids`)
  return v as string[]
}
```

Replace the `get_task` description and handler:

```ts
    description: 'One task with all five markdown fields, its checklist and its full work log.',
```

```ts
    handler: async a => {
      const task = await resolveTask(a.id)
      const [checklist, log] = await Promise.all([listChecklist(task.id), listLog(task.id)])
      // id/text/done only: taskId repeats the task, and order is the
      // array's own order.
      return JSON.stringify({
        ...task, checklist: checklist.map(({ id, text, done }) => ({ id, text, done })), log,
      }, null, 2)
    },
```

In `create_task`, change `properties` to:

```ts
      properties: {
        project: { type: 'string' },
        ...TASK_FIELDS,
        checklist: {
          type: 'array', items: { type: 'string' },
          description: 'Checklist items to start the task with, in order. Change them later with update_checklist.',
        },
      },
```

and the handler to:

```ts
    handler: async a => {
      const p = await project(a.project)
      const patch = taskPatch(a)
      if (!patch.title?.trim()) throw new ToolError('title is required')
      // Validated before the task exists, so a bad item never leaves a
      // half-made task behind.
      const items = itemTexts(a.checklist, 'checklist')
      const task = await createTask(p.id, { ...patch, title: patch.title })
      if (items.length) await addChecklistItems(task, items)
      // The id, and the two things the server decided rather than the caller
      // (which column it landed in, and whether the untriaged default
      // applied). Not the bodies — the caller just sent those.
      return JSON.stringify({
        ok: true, id: task.id, status: task.status, labels: task.labels,
        ...(items.length ? { checklist: items.length } : {}),
      })
    },
```

After the `update_task` tool, add:

```ts
  {
    name: 'update_checklist',
    title: "Change a task's checklist",
    description:
      'Add, tick, untick or remove checklist items in one call — tick items off as you finish them so the human sees progress on the board. Item ids come from get_task. Applied in the order remove, check, uncheck, add; new items go to the bottom. Returns the done/total counts and the ids of added items, not the list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id, or a unique prefix of one.' },
        add: { type: 'array', items: { type: 'string' }, description: 'Texts of new items.' },
        check: { type: 'array', items: { type: 'string' }, description: 'Item ids to mark done.' },
        uncheck: { type: 'array', items: { type: 'string' }, description: 'Item ids to mark not done.' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Item ids to delete.' },
      },
      required: ['id'],
    },
    handler: async a => {
      const task = await resolveTask(a.id)
      const add = itemTexts(a.add, 'add')
      const check = itemIds(a.check, 'check')
      const uncheck = itemIds(a.uncheck, 'uncheck')
      const remove = itemIds(a.remove, 'remove')
      if (!add.length && !check.length && !uncheck.length && !remove.length)
        throw new ToolError('nothing to change: pass add, check, uncheck or remove')

      // Everything is checked before the first write, so a bad call changes
      // nothing rather than half of what it asked for.
      const own = new Set((await listChecklist(task.id)).map(i => i.id))
      const stray = [...check, ...uncheck, ...remove].filter(i => !own.has(i))
      if (stray.length) throw new ToolError(`not items of task ${task.id}: ${stray.join(', ')}`)
      const removed = new Set(remove)
      if (own.size - removed.size + add.length > CHECKLIST_COUNT_MAX)
        throw new ToolError(`a checklist holds at most ${CHECKLIST_COUNT_MAX} items (this one has ${own.size})`)

      for (const i of removed) await deleteChecklistItem(i)
      for (const i of check) if (!removed.has(i)) await updateChecklistItem(i, { done: true })
      for (const i of uncheck) if (!removed.has(i)) await updateChecklistItem(i, { done: false })
      const added = add.length ? await addChecklistItems(task, add) : []

      const items = await listChecklist(task.id)
      return JSON.stringify({
        ok: true, id: task.id,
        done: items.filter(i => i.done).length, total: items.length,
        added: added.map(i => i.id),
      })
    },
  },
```

In `app/api/mcp/route.ts:60`, extend the instructions string's last sentence so agents learn the tool exists — replace `The human reads that log stream in the UI, dead ends included.` with:

```
The human reads that log stream in the UI, dead ends included. If the task has a checklist (get_task shows it), tick items off with update_checklist as you finish them.
```

- [ ] **Step 4: Run the probe**

Run: `node --import tsx test/checklist-probe.mts`
Expected: every `✓`, `all checklist checks passed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add app/api/mcp/tools.ts app/api/mcp/route.ts test/checklist-probe.mts
git commit -m "feat: agents read and tick the checklist over MCP"   # plus trailers
```

---

### Task 3: REST — checklist routes

**Files:**
- Modify: `app/api/tasks/[id]/route.ts` (GET; DELETE doc comment)
- Create: `app/api/tasks/[id]/checklist/route.ts`
- Create: `app/api/tasks/[id]/checklist/[itemId]/route.ts`
- Test: `test/api-contract.mjs`

**Interfaces:**
- Consumes: `listChecklist`, `getChecklistItem`, `addChecklistItems`, `updateChecklistItem`, `deleteChecklistItem` (Task 1); `checklistText`, `LimitError`, `ChecklistItem` (lib/shared); `requireCaller, isResponse, json, bad, checkOrder` (app/api/_util.ts).
- Produces:
  - `GET /api/tasks/:id` → task + `checklist: ChecklistItem[]`
  - `POST /api/tasks/:id/checklist` `{ text }` → 201 `ChecklistItem`
  - `PATCH /api/tasks/:id/checklist/:itemId` `{ text?, done?, order? }` → 200 `ChecklistItem`
  - `DELETE /api/tasks/:id/checklist/:itemId` → 200 `{ deleted: itemId }`

- [ ] **Step 1: Write the failing contract checks** — in `test/api-contract.mjs`, insert after the `// --- work log ---` block closes:

```js
  // --- checklist ------------------------------------------------------------
  {
    const add = text => api(`/api/tasks/${id}/checklist`, { method: 'POST', body: JSON.stringify({ text }) })
    const item = (itemId, init) => api(`/api/tasks/${id}/checklist/${itemId}`, init)

    const one = await add('first')
    const two = await add('  second  ')
    check('POST checklist returns 201 with the new item',
      one.status === 201 && one.body.text === 'first' && one.body.done === false)
    check('item text is trimmed', two.body.text === 'second')

    const tick = await item(two.body.id, { method: 'PATCH', body: JSON.stringify({ done: true }) })
    check('PATCH ticks an item', tick.status === 200 && tick.body.done === true)

    await item(two.body.id, { method: 'PATCH', body: JSON.stringify({ order: one.body.order - 1 }) })
    const read = await api(`/api/tasks/${id}`)
    check('GET task carries the checklist, in order',
      read.body.checklist.map(i => i.text).join() === 'second,first')

    const del = await item(one.body.id, { method: 'DELETE' })
    check('DELETE removes one item',
      del.status === 200 && (await api(`/api/tasks/${id}`)).body.checklist.length === 1)

    // Refusals.
    check('blank text is a 400', (await add('   ')).status === 400)
    check('over-length text is a 400', (await add('x'.repeat(513))).status === 400)
    check('a missing text is a 400', (await api(`/api/tasks/${id}/checklist`, { method: 'POST', body: '{}' })).status === 400)
    const notBool = await item(two.body.id, { method: 'PATCH', body: JSON.stringify({ done: 'yes' }) })
    check('a non-boolean done is a 400', notBool.status === 400)
    const nothing = await item(two.body.id, { method: 'PATCH', body: JSON.stringify({ taskId: 'x' }) })
    check('PATCH with no writable field is a 400', nothing.status === 400)

    const other = await api('/api/tasks', {
      method: 'POST', body: JSON.stringify({ project: project.slug, title: `checklist neighbour ${stamp}` }),
    })
    createdTaskIds.push(other.body.id)
    const elsewhere = await api(`/api/tasks/${other.body.id}/checklist/${two.body.id}`, {
      method: 'PATCH', body: JSON.stringify({ done: false }),
    })
    check("an item addressed through another task's URL is a 404", elsewhere.status === 404)

    const missing = await api('/api/tasks/does-not-exist-checklist/checklist', {
      method: 'POST', body: JSON.stringify({ text: 'x' }),
    })
    check('POST checklist on an unknown task is a 404', missing.status === 404)
  }
```

- [ ] **Step 2: Run it to see it fail** (needs the dev server)

Run (terminal A): `npm run dev`
Run (terminal B): `TEST_PROJECT=scratch npm run test:api`
Expected: FAIL at `POST checklist returns 201 with the new item` (404 from Next).

- [ ] **Step 3: Implement**

In `app/api/tasks/[id]/route.ts`, add `listChecklist` to the `@/lib/db` import, and replace `GET`'s last line with:

```ts
  return task ? json({ ...task, checklist: await listChecklist(task.id) }) : bad('no such task', 404)
```

Update the `DELETE` doc comment's first sentence to: `Deletes the task, its checklist (deleteTask does that itself) and its work log entries.`

Create `app/api/tasks/[id]/checklist/route.ts`:

```ts
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
```

Create `app/api/tasks/[id]/checklist/[itemId]/route.ts`:

```ts
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
```

- [ ] **Step 4: Run the contract suite**

Run: `TEST_PROJECT=scratch npm run test:api`
Expected: every `✓` including the new checklist lines, `all contract checks passed`, and `(cleaned up N probe task(s))`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add app/api/tasks test/api-contract.mjs
git commit -m "feat: the checklist on the REST door"   # plus trailers
```

---

### Task 4: Detail page — the Checklist section

**Files:**
- Modify: `app/p/[slug]/actions.ts` (imports; four actions at the end)
- Create: `app/p/[slug]/t/[id]/checklist.tsx`
- Modify: `app/p/[slug]/t/[id]/page.tsx` (imports, data fetch, render)

**Interfaces:**
- Consumes: `listChecklist`, `getChecklistItem`, `addChecklistItems`, `updateChecklistItem`, `deleteChecklistItem`, `deleteChecklist` (Task 1); `checklistText`, `CHECKLIST_TEXT_MAX`, `ChecklistItem` (lib/shared); `nextOrder` (lib/order.mjs); existing `ownedTask`, `requireUser` in actions.ts.
- Produces (server actions):
  - `addChecklistItem(slug: string, taskId: string, text: string): Promise<void>`
  - `editChecklistItem(slug: string, taskId: string, itemId: string, patch: { text?: string; done?: boolean; order?: number }): Promise<void>`
  - `removeChecklistItem(slug: string, taskId: string, itemId: string): Promise<void>`
  - `clearChecklist(slug: string, taskId: string): Promise<void>`
  - `<Checklist slug taskId items />`

- [ ] **Step 1: Server actions** — in `app/p/[slug]/actions.ts`:

Add to the `@/lib/db` import: `getChecklistItem, addChecklistItems, updateChecklistItem, deleteChecklistItem, deleteChecklist`.
Add to the `@/lib/shared` import: `checklistText, type ChecklistItem`.

Append:

```ts
// --- checklist ---------------------------------------------------------------
// Same guards as the task actions above: a signed-in user, and a task that
// belongs to the slug. Items get one more — the item must belong to the task
// — since itemId arrives from the client independently of both.

async function ownedItem(slug: string, taskId: string, itemId: string) {
  await ownedTask(slug, taskId)
  const item = await getChecklistItem(itemId)
  if (!item || item.taskId !== taskId) throw new Error('no such checklist item')
  return item
}

/** The task page, and the board whose card shows the progress bar. */
function revalidateTask(slug: string, taskId: string) {
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

export async function addChecklistItem(slug: string, taskId: string, text: string) {
  await requireUser()
  const task = await ownedTask(slug, taskId)
  await addChecklistItems(task, [checklistText(text)])
  revalidateTask(slug, taskId)
}

export async function editChecklistItem(
  slug: string, taskId: string, itemId: string,
  patch: { text?: string; done?: boolean; order?: number },
) {
  await requireUser()
  await ownedItem(slug, taskId, itemId)
  // Rebuilt field by field, not passed through — `patch` is client input.
  const clean: Partial<Pick<ChecklistItem, 'text' | 'done' | 'order'>> = {}
  if (patch.text !== undefined) clean.text = checklistText(patch.text)
  if (typeof patch.done === 'boolean') clean.done = patch.done
  if (typeof patch.order === 'number' && Number.isFinite(patch.order)) clean.order = patch.order
  if (Object.keys(clean).length === 0) throw new Error('nothing to save')
  await updateChecklistItem(itemId, clean)
  revalidateTask(slug, taskId)
}

export async function removeChecklistItem(slug: string, taskId: string, itemId: string) {
  await requireUser()
  await ownedItem(slug, taskId, itemId)
  await deleteChecklistItem(itemId)
  revalidateTask(slug, taskId)
}

export async function clearChecklist(slug: string, taskId: string) {
  await requireUser()
  await ownedTask(slug, taskId)
  await deleteChecklist(taskId)
  revalidateTask(slug, taskId)
}
```

- [ ] **Step 2: The component** — create `app/p/[slug]/t/[id]/checklist.tsx`:

```tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { nextOrder } from '@/lib/order.mjs'
// From '@/lib/shared', never '@/lib/db' — this is a client component.
import { CHECKLIST_TEXT_MAX, type ChecklistItem } from '@/lib/shared'
import { addChecklistItem, editChecklistItem, removeChecklistItem, clearChecklist } from '../../actions'
import { Button } from '@/components/ui/button'

export function Checklist({ slug, taskId, items: saved }: {
  slug: string; taskId: string; items: ChecklistItem[]
}) {
  // A local copy so a tick shows at once. Resynced whenever the server sends
  // a new list — after a save, the focus poll, or an agent's write — during
  // render, the same way MarkdownField syncs its value.
  const [items, setItems] = useState(saved)
  const [synced, setSynced] = useState(saved)
  if (saved !== synced) {
    setSynced(saved)
    setItems(saved)
  }

  const [hideDone, setHideDone] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Show `next` now, save, and put the old list back if the save fails. */
  function apply(next: ChecklistItem[], save: () => Promise<void>) {
    const before = items
    setItems(next)
    setError(null)
    start(async () => {
      try { await save() } catch (e) {
        setItems(before)
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  // Not optimistic: the new item's id comes from the server, and the
  // revalidated page brings it back with the rest of the list.
  function add() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setError(null)
    start(async () => {
      try { await addChecklistItem(slug, taskId, text) } catch (e) {
        setDraft(text)
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  const patchItem = (id: string, patch: Partial<ChecklistItem>) =>
    apply(items.map(i => (i.id === id ? { ...i, ...patch } : i)),
      () => editChecklistItem(slug, taskId, id, patch))

  // ponytail: a drop lands the dragged item above the one it was dropped on,
  // so reaching the very bottom takes dragging the last item up instead.
  // Add a drop zone under the list if that ever annoys anyone.
  function drop(beforeId: string) {
    const id = dragging
    setDragging(null)
    if (!id || id === beforeId) return
    const order = nextOrder(items, beforeId, id)
    apply(items.map(i => (i.id === id ? { ...i, order } : i)).sort((a, b) => a.order - b.order),
      () => editChecklistItem(slug, taskId, id, { order }))
  }

  const done = items.filter(i => i.done).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0
  const shown = hideDone ? items.filter(i => !i.done) : items

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex flex-1 items-baseline gap-2 text-sm font-semibold">
          Checklist
          {pending && <span className="text-[12px] font-normal text-tt-subtle">saving…</span>}
        </h3>
        {items.length > 0 && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setHideDone(h => !h)}>
              {hideDone ? `Show checked items (${done})` : 'Hide checked items'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (confirm('Delete this checklist?\n\nEvery item on it is removed for good.'))
                apply([], () => clearChecklist(slug, taskId))
            }}>
              Delete
            </Button>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div className="mb-1 flex items-center gap-2 px-1">
          <span className="w-8 text-[11px] text-tt-subtle">{pct}%</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-tt-column">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-tt-green' : 'bg-tt-blue'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <ul>
        {shown.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            onToggle={() => patchItem(item.id, { done: !item.done })}
            onRename={text => patchItem(item.id, { text })}
            onRemove={() => apply(items.filter(i => i.id !== item.id),
              () => removeChecklistItem(slug, taskId, item.id))}
            onDragStart={() => setDragging(item.id)}
            onDrop={() => drop(item.id)}
          />
        ))}
      </ul>

      <input
        value={draft}
        onChange={e => { setDraft(e.target.value); setError(null) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        placeholder="Add an item"
        maxLength={CHECKLIST_TEXT_MAX}
        className="mt-1 w-full rounded-[3px] border border-tt-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tt-blue focus:ring-1 focus:ring-tt-blue"
      />
      {error && <p className="mt-1 text-xs text-tt-red">not saved: {error}</p>}
    </section>
  )
}

function ItemRow({ item, onToggle, onRename, onRemove, onDragStart, onDrop }: {
  item: ChecklistItem
  onToggle: () => void
  onRename: (text: string) => void
  onRemove: () => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const [editing, setEditing] = useState(false)
  // Escape blurs the input too; this tells the blur handler not to save.
  const cancelled = useRef(false)

  function finish(value: string) {
    setEditing(false)
    if (cancelled.current) { cancelled.current = false; return }
    const text = value.trim()
    if (text && text !== item.text) onRename(text)
  }

  return (
    <li
      draggable={!editing}
      onDragStart={onDragStart}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDrop() }}
      className="group flex items-center gap-2 rounded-[3px] px-1 py-1 hover:bg-tt-hover"
    >
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggle}
        aria-label={`Done: ${item.text}`}
        className="size-4 shrink-0 accent-tt-blue"
      />
      {editing ? (
        <input
          autoFocus
          defaultValue={item.text}
          maxLength={CHECKLIST_TEXT_MAX}
          onBlur={e => finish(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur() }
          }}
          className="min-w-0 flex-1 rounded-[3px] border-2 border-tt-blue bg-white px-1.5 py-0.5 text-sm outline-none"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 cursor-text text-sm [overflow-wrap:anywhere] ${
            item.done ? 'text-tt-subtle line-through' : ''
          }`}
        >
          {item.text}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Delete item: ${item.text}`}
        className="shrink-0 px-1 text-tt-subtle opacity-0 hover:text-tt-red focus:opacity-100 group-hover:opacity-100"
      >
        ✕
      </button>
    </li>
  )
}
```

- [ ] **Step 3: Wire it into the page** — in `app/p/[slug]/t/[id]/page.tsx`:

Change the imports:

```ts
import { Fragment } from 'react'
import { getTask, listLog, listChecklist, getProjectBySlug } from '@/lib/db'
import { Checklist } from './checklist'
```

Change the data fetch to:

```ts
  const [user, project, task, log, checklist] = await Promise.all([
    currentUser(), getProjectBySlug(slug), getTask(id), listLog(id), listChecklist(id),
  ])
```

Replace the `FIELDS.map(...)` block with:

```tsx
            {FIELDS.map(([field, label]) => (
              <Fragment key={field}>
                <MarkdownField slug={slug} taskId={task.id}
                  field={field} label={label} value={task[field as keyof typeof task] as string} />
                {/* Right under Description: the checklist is part of what the task is. */}
                {field === 'description' && <Checklist slug={slug} taskId={task.id} items={checklist} />}
              </Fragment>
            ))}
```

- [ ] **Step 4: Verify in the browser** — dev server running, signed in with the `TEST_EMAIL` account. Create a probe task with the MCP `create_task` tool (or `POST /api/tasks`) in project **scratch** and open `/p/scratch/t/<id>`. Check each, in order:
  1. The "Checklist" heading shows under Description, with only the "Add an item" input.
  2. Type `one` + Enter, `two` + Enter, `three` + Enter → three rows in order; the input keeps focus and is cleared.
  3. Tick `two` → it's struck through at once; the bar reads 33%.
  4. Click `one`, change it to `one edited`, Enter → saved; Escape on another edit → unchanged.
  5. Hide checked items → `two` disappears; the button reads "Show checked items (1)".
  6. Drag `three` onto `one edited` → `three` moves above it; reload keeps the order.
  7. Hover a row → ✕ appears; click it → the row goes.
  8. Tick everything → the bar is green at 100%.
  9. Delete → confirm → the checklist is empty.
  10. Paste 600 characters into "Add an item" → the input stops at 512.

Delete the probe task from the page's Delete button when done.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add 'app/p/[slug]/actions.ts' 'app/p/[slug]/t/[id]/checklist.tsx' 'app/p/[slug]/t/[id]/page.tsx'
git commit -m "feat: a checklist section on the task page"   # plus trailers
```

---

### Task 5: Board card — progress bar

**Files:**
- Modify: `app/p/[slug]/page.tsx` (fetch)
- Modify: `app/p/[slug]/board.tsx` (prop, `ChecklistBar`, card)

**Interfaces:**
- Consumes: `checklistProgress(projectId)` (Task 1), `ChecklistProgress` (lib/shared).
- Produces: `Board({ slug, tasks, progress }: { slug: string; tasks: Task[]; progress: Record<string, ChecklistProgress> })`

- [ ] **Step 1: Fetch progress with the tasks** — in `app/p/[slug]/page.tsx`:

Import `checklistProgress` from `@/lib/db`, and replace `const tasks = await listTasks({ projectId: project.id })` with:

```ts
  const [tasks, progress] = await Promise.all([
    listTasks({ projectId: project.id }), checklistProgress(project.id),
  ])
```

and render `<Board slug={slug} tasks={tasks} progress={progress} />`.

- [ ] **Step 2: Draw the bar** — in `app/p/[slug]/board.tsx`:

Add `type ChecklistProgress` to the `@/lib/shared` import. Change the signature to:

```tsx
export function Board({ slug, tasks, progress }: {
  slug: string; tasks: Task[]; progress: Record<string, ChecklistProgress>
}) {
```

In the card, between the labels block and the `{/* Card footer ... */}` comment, add:

```tsx
                  {progress[t.id] && <ChecklistBar p={progress[t.id]} />}
```

At the end of the file, add:

```tsx
/** A card's checklist progress: a thin bar and `☑ 2/4`, green once complete. */
function ChecklistBar({ p }: { p: ChecklistProgress }) {
  const complete = p.done === p.total
  return (
    <div className="mb-2 flex items-center gap-1.5" title={`Checklist: ${p.done} of ${p.total} done`}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-tt-column">
        <div
          className={`h-full rounded-full ${complete ? 'bg-tt-green' : 'bg-tt-blue'}`}
          style={{ width: `${(p.done / p.total) * 100}%` }}
        />
      </div>
      <span className={`text-[11px] font-medium ${complete ? 'text-tt-green' : 'text-tt-subtle'}`}>
        ☑ {p.done}/{p.total}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Verify in the browser** — on `/p/scratch`, with a scratch probe task made by `create_task` with `checklist: ['a', 'b', 'c', 'd']`:
  1. Its card shows an empty bar and `☑ 0/4`; cards without a checklist show nothing extra.
  2. Tick two items (page or `update_checklist`), refocus the board → `☑ 2/4`, half-filled bar.
  3. Tick all → green bar and green `☑ 4/4`.
  4. Drag the card to another column → still works; the bar stays.

Delete the probe task afterwards.

- [ ] **Step 4: Full regression run**

Run: `npx tsc --noEmit && npm run lint && node --import tsx --test test/*.test.mjs test/*.test.mts && node --import tsx test/checklist-probe.mts && TEST_PROJECT=scratch npm run test:api`
Expected: everything passes; both live runs report their cleanup.

- [ ] **Step 5: Commit**

```bash
git add 'app/p/[slug]/page.tsx' 'app/p/[slug]/board.tsx'
git commit -m "feat: checklist progress on the board card"   # plus trailers
```
