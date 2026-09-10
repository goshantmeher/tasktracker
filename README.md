# Task Tracker

Kanban task tracker. Humans use the UI; Claude uses the API. One source of
truth, so neither goes stale.

## Setup

1. Create an Appwrite project and an API key with `databases.*`,
   `collections.*`, `attributes.*`, `indexes.*`, `documents.*` and
   `users.read` scopes.
2. Fill in `.env.local` (see the file for the four required variables).
3. `npm install && npm run setup` — creates the database schema. Idempotent.
4. Create users in the Appwrite console under Auth. There is no signup page.
5. `npm run dev`

## For Claude

Mint a key at `/settings/keys`, then at the start of a session:

```bash
curl -s -H "x-api-key: $TASKTRACKER_KEY" \
  "$TASKTRACKER_URL/api/context?project=<slug>"
```

That returns the whole board as markdown: caveats first, then open tasks with
their descriptions, requirements and recent work log, then finished work.

Write progress back:

```bash
# Move a task and record what happened
curl -X PATCH -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"status":"in_progress"}' "$URL/api/tasks/<id>"

curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"body":"Tried the migration, hit a FK constraint on orders."}' \
  "$URL/api/tasks/<id>/log"

# Flag something everyone should remember, including on other tasks
curl -X PATCH -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"notes":"The orders table has no cascade. Delete children first."}' \
  "$URL/api/tasks/<id>"
```

`PATCH` is partial — send only the fields you are changing. Fields you omit
are left alone, so writing `result` cannot clobber a `requirement`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/context?project=<slug>` | Whole board as markdown. Start here. |
| GET | `/api/projects` | List projects |
| GET | `/api/tasks?project=<slug>` | Filter by `status`, `type`, `assignee`, `label`, `limit` |
| POST | `/api/tasks` | Create. `project` and `title` required |
| GET/PATCH | `/api/tasks/<id>` | Read or partially update |
| GET/POST | `/api/tasks/<id>/log` | Read or append work log |
| POST | `/api/login` | Exchange email/password for a session cookie |

Every route above except `/api/login` requires a caller: either an
`x-api-key` header or the browser's session cookie — both resolve through
the same `resolveCaller()` and land on the same data layer, so a human
dragging a card and an agent PATCHing the same task hit identical code.

`POST /api/login` is how a non-browser client (curl, a script, an agent)
gets that session cookie — the browser's own login form is a Server Action,
which nothing outside a browser can invoke. It is unauthenticated and
internet-reachable by design, with no bespoke rate limiting here: that is
the same exposure the browser login form already has, and Appwrite
rate-limits its own auth endpoint. Most agents should use an API key
instead; this endpoint exists for parity, not as the recommended path.

## Tests

```bash
npm test
```

Runs `node --test` over the pure-function unit tests in `test/*.test.mjs`
and `test/*.test.mts` (37 tests, no framework — `node:test` and
`node:assert` only), then the HTTP contract test (`test/api-contract.mjs`,
38 checks) against a running dev server — so start `npm run dev` in another
terminal first. Needs `TEST_API_KEY`, `TEST_EMAIL` and `TEST_PASSWORD` in
`.env.local`; if either of the latter two is missing, the contract test's
cross-door checks (cookie login vs. API key, proving both land in the same
place) are skipped, which means the single most important property in this
system goes unverified — fill them in rather than ignoring the skip.

## Deliberately not built

Realtime (polling on focus instead), comments, due dates, sprints,
notifications, attachments, configurable columns, roles, and rate limiting
on `/api/login`. See `docs/superpowers/specs/2026-09-10-tasktracker-design.md`.
