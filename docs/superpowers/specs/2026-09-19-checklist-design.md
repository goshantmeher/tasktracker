# Task checklist — design

2026-09-19. Approved in chat (option A).

## Goal

A checklist inside each task: a list of items, each with text and a
checkbox, that a human ticks off in the web UI and an agent ticks off over
MCP or REST. Modelled on the Trello/Jira checklist: progress bar, "Hide
checked items", "Delete".

Out of scope (add when asked): per-item assignee, per-item due date,
promoting an item to a real task, more than one checklist per task.

## Data

New Appwrite collection `checklist`, one document per item:

| attribute   | type            | notes                                          |
|-------------|-----------------|------------------------------------------------|
| `taskId`    | string 36, req  | owner task                                     |
| `projectId` | string 36, req  | copied from the task; lets the board read every item for a project in one query |
| `text`      | string 512, req | trimmed, non-empty                             |
| `done`      | boolean, default false |                                         |
| `order`     | float, req      | same float-midpoint scheme as cards (`lib/order.mjs`) |

Indexes: `by_task` on `[taskId, order]`, `by_project` on `[projectId]`.

Why a collection and not an array field on the task: every tick is a write
to one item, so a human and an agent ticking different items at the same
time both land. An array field would rewrite the whole list per tick and
silently drop one of two concurrent ticks.

Limits, in `lib/shared.ts` and enforced identically at every entry point:
`CHECKLIST_TEXT_MAX = 512`, `CHECKLIST_COUNT_MAX = 100` items per task.

Type in `lib/shared.ts`:
`ChecklistItem = { id, taskId, text, done, order }`.

## lib/db.ts

- `listChecklist(taskId)` — items ordered by `order`.
- `checklistProgress(projectId)` — `Map<taskId, { done, total }>` from one
  query selecting `taskId` and `done` only.
- `addChecklistItems(task, texts[])` — appends at the bottom, in order.
- `updateChecklistItem(id, { text?, done?, order? })` — partial, via `patchDoc`.
- `deleteChecklistItem(id)`.
- `deleteChecklist(taskId)` — every item of a task, one by one. Called by
  "Delete", and by `deleteTask` itself, so every task-delete path (the
  `removeTask` action, `DELETE /api/tasks/:id`, test cleanup) clears items
  without having to remember to.

All ids go through the existing `docId` guard.

## Web UI

Detail page (`app/p/[slug]/t/[id]/page.tsx`): a Checklist section right
after Description, as a client component in `detail.tsx`:

- Header "Checklist" with "Hide checked items" / "Show checked items"
  toggle and "Delete" (native `confirm`, like task delete). Both buttons
  only when there are items.
- Progress: `NN%` and a bar; the bar turns green at 100%.
- Rows: checkbox, text (struck through and muted when done). Click text to
  edit inline (Enter saves, Escape cancels). Hover shows a delete ✕.
- Drag a row to reorder (HTML5 drag, `orderBetween`).
- "Add an item" input at the bottom; Enter adds and keeps focus for the
  next one.
- Optimistic: ticks and edits show immediately; a failed save restores the
  previous state and shows the error inline, same as `MarkdownField`.

Server actions in `app/p/[slug]/actions.ts`, each with `requireUser()` and
the same slug/task integrity guard `moveTask` uses, then
`revalidatePath`.

Board card (`board.tsx`): when a task has items, the footer gets a thin
progress bar and `☑ 2/4`; green when complete. The board page passes the
`checklistProgress` map in.

## MCP (`app/api/mcp/tools.ts`)

- `get_task` returns `checklist: [{ id, text, done }]` alongside `log`.
- `create_task` accepts `checklist: string[]` — items created after the
  task, in order.
- New `update_checklist`:
  `{ id, add?: string[], check?: string[], uncheck?: string[], remove?: string[] }`.
  Item ids are validated as belonging to the task. Applied in the order
  remove, check/uncheck, add. Returns
  `{ ok, id, done, total, added: [ids] }` — the counts, not the list.
- `get_board` is unchanged (it is the cheap index).

## REST

- `GET /api/tasks/:id` includes `checklist`.
- `POST /api/tasks/:id/checklist` `{ text }` → 201 with the item.
- `PATCH /api/tasks/:id/checklist/:itemId` `{ text?, done?, order? }`.
- `DELETE /api/tasks/:id/checklist/:itemId`.
- 404 when the task is missing or the item belongs to another task; 400 on
  bad types, blank text, over-length text, or the 101st item.

## Housekeeping

- `scripts/setup-appwrite.mjs` creates the collection and indexes
  (idempotent, like the rest).
- `scripts/backup.mjs` adds `checklist` to `COLLECTIONS`.

## Testing

Everything that writes runs against the `scratch` project, after a backup.
Never `deepfront`.

Phase 1, happy path:
- `test/api-contract.mjs`: add → list via GET task → tick → reorder →
  delete item → delete task removes its items.
- MCP: `create_task` with a checklist, `update_checklist` add/check/remove,
  `get_task` shows the result.
- Browser on a scratch task: add, tick, edit, hide checked, delete; card
  shows the bar.

Phase 2, negative paths: blank/over-length text, 101st item, item id from
another task, missing task, non-boolean `done`.
