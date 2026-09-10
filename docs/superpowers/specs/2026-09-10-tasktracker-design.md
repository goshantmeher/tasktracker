# Task Tracker — Design

Date: 2026-09-10
Status: Approved, ready for implementation planning

## Problem

Task tracking currently lives in markdown files across several projects. That
format works well for Claude to write but poorly for a human to read: there is
no board, no cross-cutting view, and no reliable way to know whether a file is
current. Meanwhile Claude loses accumulated context between sessions because
the file is the only record and it drifts from reality.

The fix is not a better file format. It is one source of truth with two faces:
a kanban UI for the human, and an HTTP API for Claude.

GitHub Projects and Linear were considered and rejected: the work spans repos
and clients that are not all on GitHub, so a central tracker of our own is the
point.

## Goals

- A kanban board per project, managed from the browser.
- An HTTP API that lets Claude read the current board and write back progress.
- A single call that brings Claude fully up to date at the start of a session.
- Markdown files stop being the record of truth.

## Non-goals

Deliberately excluded from v1. Each is cheap to add later if it becomes
load-bearing; none is needed to make the tracker useful:

- Comments and threads (the work log covers this)
- Due dates, sprints, milestones, burndown charts
- Notifications and email
- File attachments
- Configurable columns per board
- Per-project permissions and roles
- Activity feed beyond the work log
- Markdown file sync in either direction

## Architecture

SSR-first. Appwrite is reached only from the Next.js server via
`node-appwrite`. Nothing Appwrite-related reaches the browser: no project ID,
no endpoint, no client SDK.

```
You  ->  Next.js (server components + server actions)  ┐
             ^ httpOnly cookie -> client.setSession()  │
                                                       ├-> lib/tasks.ts -> Appwrite
Claude -> curl /api/*  ->  route handler                │
             ^ X-API-Key -> client.setKey()            ┘
```

`lib/tasks.ts` is the only module that talks to Appwrite. Every read and write
in the application goes through it. A single `resolveCaller()` helper turns
either a session cookie or an `X-API-Key` header into an identity; the data
layer does not care which front door a request came through. This is the main
structural benefit of the SSR approach — the UI and the API are the same code,
so they cannot drift.

### Realtime

Live board updates are not built. Browser-side Appwrite subscriptions require
credentials in client JavaScript, which the SSR constraint rules out.

Replacement: `router.refresh()` on window focus, plus a 10 second poll while
the tab is visible. This covers the real case — returning to the board after
Claude has been working and finding it current.

Upgrade path, to be marked with a `ponytail:` comment in the polling code:
proxy Appwrite's realtime stream through a Next.js SSE route where the server
holds the subscription. Build it only if polling proves visibly inadequate.

## Data model

Four Appwrite collections in one database. Appwrite's built-in `$id`,
`$createdAt` and `$updatedAt` are used throughout; no timestamp attributes are
duplicated.

### projects

| Attribute | Type | Notes |
|---|---|---|
| name | string(128) | required |
| slug | string(64) | required, unique index; used in API URLs |
| archived | boolean | default false |

### tasks

| Attribute | Type | Notes |
|---|---|---|
| projectId | string(36) | required, indexed |
| title | string(256) | required |
| description | string(65535) | optional, markdown — what the task is |
| requirement | string(65535) | optional, markdown — what done looks like |
| prerequisites | string(65535) | optional, markdown — what must be true first |
| result | string(65535) | optional, markdown — what actually happened |
| notes | string(65535) | optional, markdown — caveats to keep in mind |
| type | enum | `bug` \| `feature` \| `chore`, default `feature` |
| status | enum | `backlog` \| `todo` \| `in_progress` \| `blocked` \| `done`, default `backlog` |
| priority | enum | `low` \| `medium` \| `high` \| `urgent`, default `medium` |
| assignee | string(64) | optional |
| labels | string(64)[] | optional |
| order | double | required; position within its column |

Indexes: `(projectId, status)`, `(projectId, order)`.

The five long-text fields are all markdown and all optional. They are separate
attributes rather than one body with headings so that a caller can write one
without rewriting the others — Claude appending a `result` must not be able to
clobber a `requirement` the human wrote — and so `/api/context` can include
the setup fields while omitting results for tasks that are not finished.

Appwrite stores string attributes of this size off-row, so five per document
is not a document-size concern.

`notes` and `worklog` serve different purposes and differ in scope. `worklog`
is history: append-only, timestamped, and only ever read in the context of its
own task. `notes` is a standing caveat — "when touching this, remember X" —
that stays relevant while working on *other* tasks, and is therefore
deliberately surfaced outside the task that owns it: aggregated at the top of
`/api/context` and flagged on the board card. A note on a `done` task is not
stale; a finished task's gotcha is exactly what bites weeks later.

Statuses are a fixed set, not per-board configuration. Configurable columns
mean a columns collection, ordering UI, and a migration path whenever one is
renamed, and there is no second board yet that needs different ones.
`blocked` earns its place specifically for the Claude workflow: it is how
Claude signals it is stuck without the human having to read a log.

### worklog

| Attribute | Type | Notes |
|---|---|---|
| taskId | string(36) | required, indexed |
| author | string(64) | required; human name or API key label |
| body | string(65535) | required, markdown |

Index: `(taskId, $createdAt desc)`. Append-only; entries are never edited or
deleted through the API.

### api_keys

| Attribute | Type | Notes |
|---|---|---|
| label | string(64) | required; shown in settings and used as work log author |
| hash | string(64) | required, unique index; SHA-256 of the key |
| lastUsedAt | datetime | optional |
| createdBy | string(64) | required |

No user has read access to this collection. It is reachable only via the
server key.

### Card ordering

`order` is a float. A card dropped between two neighbours takes the midpoint
of their values; dropped at the top of a column it takes `min - 1`, at the
bottom `max + 1`. No reindexing writes on drop.

This degrades after enough repeated drags into the same gap that float
precision runs out — in the low thousands, in a single column, which will not
happen here. Mark with a `ponytail:` comment naming a renumber pass as the
upgrade path.

## Authentication

### Humans

Appwrite email/password via the official SSR flow:

1. `account.createEmailPasswordSession(email, password)` on the server returns
   a session containing a `secret`.
2. The secret is stored in an httpOnly, secure, `sameSite=lax` cookie named
   `tt_session`, scoped to the Next.js domain, with `maxAge` matching the
   session expiry.
3. Each subsequent request builds a server client with `.setSession(secret)`
   and acts as that user.

Next.js middleware redirects any request without a valid `tt_session` cookie
to `/login`, excluding `/login` itself and `/api/*` (which authenticates by
key instead).

There is no signup page. Teammates are created directly in the Appwrite
console — there are a handful of them and they are known people.

Since all teammates see all boards, authorization is "valid session means full
access". No per-document Appwrite permissions are configured.

### Claude

`X-API-Key` header. The route handler hashes the presented key with SHA-256
and looks it up in `api_keys`; a miss returns 401. On a hit, `lastUsedAt` is
updated and the key's `label` becomes the identity used as the default work
log author.

Keys are generated server-side as 32 random bytes, hex encoded. The plaintext
key is returned once in the response that creates it, for the human to copy,
and is never stored or retrievable afterward — only the hash is persisted.

Rate limiting is not implemented. The API is used by one agent and a few
people.

## API

All responses are JSON except `/api/context`. Errors return the appropriate
status code with a body of `{ "error": "message" }`.

### `GET /api/projects`

Returns non-archived projects.

```json
{ "projects": [{ "id": "...", "name": "Task Tracker", "slug": "tasktracker" }] }
```

### `GET /api/tasks`

Query parameters, all optional except `project`:

| Param | Notes |
|---|---|
| `project` | required, project slug |
| `status` | comma-separated, e.g. `todo,in_progress` |
| `assignee` | exact match |
| `type` | comma-separated |
| `label` | matches tasks carrying this label |
| `limit` | default 100 |

With no `status` filter, tasks of every status are returned including `done`.
Callers that want only live work pass `status=backlog,todo,in_progress,blocked`.

Returns `{ "tasks": [ ... ] }`, each task as stored plus its `id`, ordered by
status then `order`.

### `POST /api/tasks`

Body: `project` (slug, required), `title` (required), and optionally
`description`, `requirement`, `prerequisites`, `result`, `notes`, `type`,
`status`, `priority`, `assignee`, `labels`.

Defaults apply for anything omitted. `order` is assigned automatically at the
bottom of the target column. Returns the created task with 201.

### `PATCH /api/tasks/:id`

Body is any subset of `title`, `description`, `requirement`, `prerequisites`,
`result`, `notes`, `type`, `status`, `priority`, `assignee`, `labels`,
`order`. Fields omitted from the body are left untouched, so a caller can
write `result` alone without resending the rest. `projectId` is not writable — tasks do not move
between projects. Returns the updated task.

### `POST /api/tasks/:id/log`

Body: `body` (required), `author` (optional). When omitted the author is the
caller identity from `resolveCaller()`: the Appwrite user's name for a session
cookie, or the key's `label` for an API key. Appends a work log entry. Returns
the created entry with 201.

### `GET /api/context?project=<slug>`

Returns `text/markdown`: the whole board rendered for an agent to read in one
call, in this order:

1. **Keep in mind** — every non-empty `notes` field in the project, each
   labelled with its task title, drawn from tasks of *every* status including
   `done`. This section leads because its whole purpose is to be read while
   working on something else.
2. **Open tasks** grouped by status, each with its `description`,
   `requirement` and `prerequisites`, omitting whichever are empty, plus the
   most recent work log entries.
3. **Done** — titles only, each with its `result` if it has one.

This endpoint is the point of the system. One call at the start of a session
brings Claude current on everything the human added through the UI, and unlike
the markdown files it replaces it cannot be stale, because it is generated
from the same rows the board renders.

## UI

Five screens, no more.

- **`/login`** — email and password.
- **`/`** — project list; picks a board. Creates a project, and archives or
  unarchives one; archived projects sort below the rest.
- **`/p/[slug]`** — the board. Five columns, drag-and-drop between them. Each
  card shows title, type, priority, assignee and labels. A "+" per column
  creates a task inline. A card carrying a non-empty `notes` field shows a
  marker, so caveats are visible without opening anything.
- **`/p/[slug]/t/[id]`** — task detail. The scalar fields (type, status,
  priority, assignee, labels), then the five markdown sections — description,
  requirement, prerequisites, result, notes — then the work log stream in
  chronological order with an entry box.
- **`/settings/keys`** — list API keys by label and last use; create one
  (shown once); revoke one.

### Markdown rendering

The five markdown fields render as formatted markdown by default and swap to a
plain `<textarea>` on click, saving on blur via a server action. No WYSIWYG
editor, no split-pane preview — click to edit, click away to render.

Rendering uses `react-markdown` with `remark-gfm`, which brings tables and
task lists (useful in requirements and prerequisites). `rehype-raw` is
deliberately not used: without it `react-markdown` never renders embedded HTML
and never touches `dangerouslySetInnerHTML`, so untrusted content in a task
field cannot become script. Any future need for raw HTML in these fields must
add sanitisation at the same time.

Drag-and-drop uses `useOptimistic` plus a server action and `revalidatePath`:
the card moves immediately and snaps back if the write fails.

No dashboard, no charts, no cross-project view, no settings beyond keys.

## Testing

One file, `test-api.mjs`, run against a running dev instance. It exercises the
full contract in sequence — create a task, list it, move it between columns,
append a work log entry, `PATCH` only `result` and assert the other four
markdown fields survived untouched, fetch `/api/context` and assert the task
appears under the right heading and that a note on a `done` task still reaches
the "Keep in mind" section — and asserts each result. It additionally performs
one operation via session cookie and the equivalent via API key, asserting
both land identically, which is the property that keeps the two front doors
honest.

The script reads `TEST_BASE_URL`, `TEST_API_KEY`, `TEST_EMAIL` and
`TEST_PASSWORD` from the environment; the cookie half of the run logs in
through `/login` to obtain `tt_session` the same way a browser does.

No test framework, no fixtures, no per-route suites. This is the smallest
thing that fails if the API contract breaks, and the API contract is the only
part of this system worth guarding.

## Configuration

| Variable | Purpose |
|---|---|
| `APPWRITE_ENDPOINT` | Appwrite server URL |
| `APPWRITE_PROJECT_ID` | Appwrite project |
| `APPWRITE_API_KEY` | Server key, used by `/api/*` routes |
| `APPWRITE_DATABASE_ID` | Database holding the four collections |

None are `NEXT_PUBLIC_`. That is the invariant the SSR constraint exists to
protect: if a `NEXT_PUBLIC_APPWRITE_*` variable ever appears, the design has
been violated.

Collections are created by a checked-in setup script rather than by hand in
the console, so the schema is reproducible.
