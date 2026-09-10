# Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js kanban task tracker backed by Appwrite, driven by a human through a browser UI and by Claude through an HTTP API, replacing per-project markdown task files.

**Architecture:** SSR-first. Appwrite is reached only from the Next.js server via `node-appwrite`; nothing Appwrite-related ships to the browser. Humans authenticate with an Appwrite session secret held in an httpOnly cookie; Claude authenticates with an `X-API-Key` header. Both front doors funnel into one data-access layer (`lib/db.ts`) so the UI and the API cannot drift.

**Tech Stack:** Next.js 15+ (App Router, TypeScript, Tailwind), `node-appwrite`, `react-markdown` + `remark-gfm`, native HTML5 drag-and-drop, Node's built-in `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-09-10-tasktracker-design.md`

## Global Constraints

- **No `NEXT_PUBLIC_APPWRITE_*` variable may ever exist.** If one appears, the SSR design has been violated. Only the server reads Appwrite config.
- **Only `lib/appwrite.ts` imports `node-appwrite` client constructors.** Only `lib/db.ts` performs Appwrite reads and writes. No route handler, page, or component talks to Appwrite directly.
- Environment variables, all server-only: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID`. Already stubbed in `.env.local`, which is gitignored.
- Statuses are exactly `backlog`, `todo`, `in_progress`, `blocked`, `done`. Types are exactly `bug`, `feature`, `chore`. Priorities are exactly `low`, `medium`, `high`, `urgent`.
- The five markdown fields are `description`, `requirement`, `prerequisites`, `result`, `notes`.
- `react-markdown` is used **without** `rehype-raw`. Adding raw-HTML support requires adding sanitisation in the same change.
- Next.js 15+ conventions: `cookies()` is awaited, and route/page `params` is a Promise that must be awaited.
- Node.js 22 or later.
- Commit after every task.

### Two deviations from the spec, and why

1. **The spec says "`lib/tasks.ts` is the only module that talks to Appwrite."** This plan names that module `lib/db.ts`, because it holds projects, tasks, worklog and API keys, not only tasks. The invariant is unchanged.
2. **`lib/order.mjs` and `lib/context.mjs` are plain JavaScript with JSDoc types**, not TypeScript, while the rest of `lib/` is TypeScript. Both are pure functions and are the two pieces worth unit-testing in isolation. Keeping them as `.mjs` means `node --test` imports them with no loader, no flag, and no build step — TypeScript imports them fine because `create-next-app` sets `allowJs: true`. This avoids depending on Node's type-stripping behaviour.

### Testing approach

The spec calls for one integration script and no test framework. That holds. This plan uses two zero-dependency harnesses:

- **`node --test test/*.test.mjs`** for the two pure functions (order arithmetic, context rendering). `node:test` and `node:assert` are standard library, not an installed framework.
- **`test-api.mjs`** for the HTTP contract, run against a live dev server. It grows one case per API task, which is what makes TDD possible on the routes.

---

### Task 1: Scaffold the app and create the Appwrite schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css` (all via `create-next-app`)
- Create: `scripts/setup-appwrite.mjs`
- Modify: `package.json` (add the `setup` script)

**Interfaces:**
- Consumes: nothing.
- Produces: an Appwrite database containing collections `projects`, `tasks`, `worklog`, `api_keys` with the attributes and indexes named in the spec. Every later task depends on this schema existing.

- [ ] **Step 1: Scaffold Next.js into the current directory**

The directory already contains `.git`, `.gitignore`, `.env.local` and `docs/`. Scaffold in place:

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --no-turbopack
```

Answer "yes" if it warns about a non-empty directory. Then:

```bash
npm install node-appwrite react-markdown remark-gfm
```

No drag-and-drop library is installed. Native HTML5 drag-and-drop covers moving cards between columns. If touch support on a tablet ever becomes a requirement, `@dnd-kit/core` is the upgrade — leave a `ponytail:` comment saying so when the board is built in Task 5.

- [ ] **Step 2: Confirm the installed SDK's database API surface**

Appwrite renamed `Databases` to `TablesDB` in some recent SDK majors, and method names differ between them. Do not guess — check:

```bash
node -e "const a=require('node-appwrite'); console.log(require('node-appwrite/package.json').version); console.log(Object.keys(a).join(', '))"
```

Expected: a version number and a list of exports. If `Databases` is present, the code in this plan is correct as written. If only `TablesDB` is present, translate `Databases` → `TablesDB`, `createDocument` → `createRow`, `listDocuments` → `listRows`, `updateDocument` → `updateRow`, `deleteDocument` → `deleteRow`, `create*Attribute` → `create*Column`, and `documents`/`$id` → `rows`/`$id` throughout every task in this plan. Record which naming you are using in a comment at the top of `lib/db.ts`.

- [ ] **Step 3: Write the schema setup script**

Create `scripts/setup-appwrite.mjs`. It is idempotent — re-running it after a partial failure must not throw on things that already exist.

```js
import { Client, Databases, IndexType } from 'node-appwrite'
import { readFileSync } from 'node:fs'

// Load .env.local without a dependency.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const DB = process.env.APPWRITE_DATABASE_ID
const db = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY)
)

// Appwrite throws 409 when a resource already exists. Swallow only that.
const ok = async (label, fn) => {
  try { await fn(); console.log('created', label) }
  catch (e) {
    if (e.code === 409) console.log('exists  ', label)
    else throw e
  }
}

// Attributes are created asynchronously; an index on a not-yet-available
// attribute fails. Poll until every attribute in the collection is ready.
const settle = async (col) => {
  for (let i = 0; i < 60; i++) {
    const { attributes } = await db.getCollection(DB, col)
    if (attributes.every(a => a.status === 'available')) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`attributes for ${col} never became available`)
}

await ok('database', () => db.create(DB, 'tasktracker'))

await ok('projects', () => db.createCollection(DB, 'projects', 'projects'))
await ok('projects.name', () => db.createStringAttribute(DB, 'projects', 'name', 128, true))
await ok('projects.slug', () => db.createStringAttribute(DB, 'projects', 'slug', 64, true))
await ok('projects.archived', () => db.createBooleanAttribute(DB, 'projects', 'archived', false, false))
await settle('projects')
await ok('projects/slug_unique', () => db.createIndex(DB, 'projects', 'slug_unique', IndexType.Unique, ['slug']))

await ok('tasks', () => db.createCollection(DB, 'tasks', 'tasks'))
await ok('tasks.projectId', () => db.createStringAttribute(DB, 'tasks', 'projectId', 36, true))
await ok('tasks.title', () => db.createStringAttribute(DB, 'tasks', 'title', 256, true))
for (const f of ['description', 'requirement', 'prerequisites', 'result', 'notes']) {
  await ok(`tasks.${f}`, () => db.createStringAttribute(DB, 'tasks', f, 65535, false))
}
await ok('tasks.type', () => db.createEnumAttribute(DB, 'tasks', 'type', ['bug', 'feature', 'chore'], false, 'feature'))
await ok('tasks.status', () => db.createEnumAttribute(DB, 'tasks', 'status', ['backlog', 'todo', 'in_progress', 'blocked', 'done'], false, 'backlog'))
await ok('tasks.priority', () => db.createEnumAttribute(DB, 'tasks', 'priority', ['low', 'medium', 'high', 'urgent'], false, 'medium'))
await ok('tasks.assignee', () => db.createStringAttribute(DB, 'tasks', 'assignee', 64, false))
await ok('tasks.labels', () => db.createStringAttribute(DB, 'tasks', 'labels', 64, false, undefined, true))
await ok('tasks.order', () => db.createFloatAttribute(DB, 'tasks', 'order', true))
await settle('tasks')
await ok('tasks/by_project_status', () => db.createIndex(DB, 'tasks', 'by_project_status', IndexType.Key, ['projectId', 'status']))
await ok('tasks/by_project_order', () => db.createIndex(DB, 'tasks', 'by_project_order', IndexType.Key, ['projectId', 'order']))

await ok('worklog', () => db.createCollection(DB, 'worklog', 'worklog'))
await ok('worklog.taskId', () => db.createStringAttribute(DB, 'worklog', 'taskId', 36, true))
await ok('worklog.author', () => db.createStringAttribute(DB, 'worklog', 'author', 64, true))
await ok('worklog.body', () => db.createStringAttribute(DB, 'worklog', 'body', 65535, true))
await settle('worklog')
await ok('worklog/by_task', () => db.createIndex(DB, 'worklog', 'by_task', IndexType.Key, ['taskId']))

await ok('api_keys', () => db.createCollection(DB, 'api_keys', 'api_keys'))
await ok('api_keys.label', () => db.createStringAttribute(DB, 'api_keys', 'label', 64, true))
await ok('api_keys.hash', () => db.createStringAttribute(DB, 'api_keys', 'hash', 64, true))
await ok('api_keys.lastUsedAt', () => db.createDatetimeAttribute(DB, 'api_keys', 'lastUsedAt', false))
await ok('api_keys.createdBy', () => db.createStringAttribute(DB, 'api_keys', 'createdBy', 64, true))
await settle('api_keys')
await ok('api_keys/hash_unique', () => db.createIndex(DB, 'api_keys', 'hash_unique', IndexType.Unique, ['hash']))

console.log('\nschema ready')
```

Add to `package.json` scripts:

```json
"setup": "node scripts/setup-appwrite.mjs"
```

- [ ] **Step 4: Run the setup script**

Requires `.env.local` to be filled in with real Appwrite values first.

```bash
npm run setup
```

Expected: a list of `created` lines ending in `schema ready`.

- [ ] **Step 5: Run it again to prove idempotence**

```bash
npm run setup
```

Expected: every line reads `exists`, ending in `schema ready`. No exception. This is the check that matters — a setup script that only works on a clean database is a setup script you cannot re-run after a partial failure.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app and Appwrite schema setup script"
```

---

### Task 2: Appwrite clients, auth helpers, login, and route protection

**Files:**
- Create: `lib/shared.ts`, `lib/appwrite.ts`, `lib/auth.ts`, `middleware.ts`
- Create: `app/login/page.tsx`, `app/login/actions.ts`
- Create: `test/keys.test.mjs`, `lib/keys.mjs`

**Interfaces:**
- Consumes: the schema from Task 1.
- Produces:
  - `lib/appwrite.ts`: `serverClient(): Client`, `sessionClient(secret: string): Client`, `anonClient(): Client`, `DB: string`
  - `lib/keys.mjs`: `generateKey(): string`, `hashKey(key: string): string`
  - `lib/shared.ts`: `SESSION_COOKIE`, `STATUSES`, `TYPES`, `PRIORITIES`, `MD_FIELDS`, and the `Project` / `Task` / `LogEntry` / `Status` types
  - `lib/auth.ts`: `Caller = { kind: 'user' | 'key'; name: string }`, `currentUser(): Promise<{name: string, email: string} | null>`
  - `app/login/actions.ts`: `login(prev, formData)`, `logout()`

- [ ] **Step 1: Write the failing test for key generation and hashing**

Create `test/keys.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKey, hashKey } from '../lib/keys.mjs'

test('generateKey returns 64 hex chars and never repeats', () => {
  const a = generateKey()
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, generateKey())
})

test('hashKey is deterministic, 64 hex chars, and not the key itself', () => {
  const key = generateKey()
  assert.equal(hashKey(key), hashKey(key))
  assert.match(hashKey(key), /^[0-9a-f]{64}$/)
  assert.notEqual(hashKey(key), key)
})

test('different keys hash differently', () => {
  assert.notEqual(hashKey('a'), hashKey('b'))
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test test/keys.test.mjs
```

Expected: FAIL — cannot find module `../lib/keys.mjs`.

- [ ] **Step 3: Implement the key helpers**

Create `lib/keys.mjs`:

```js
import { randomBytes, createHash } from 'node:crypto'

/** @returns {string} a fresh 32-byte API key, hex encoded */
export function generateKey() {
  return randomBytes(32).toString('hex')
}

/** @param {string} key @returns {string} SHA-256 of the key, hex encoded */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex')
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node --test test/keys.test.mjs
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the dependency-free shared module**

Create `lib/shared.ts`. **This file must never import anything.** It is the
only `lib/` module that client components and the edge middleware are allowed
to import; anything with a `node-appwrite` import in its dependency graph
would drag the SDK into the browser bundle and break the Global Constraint.

```ts
// No imports. Safe for client components and edge middleware.

export const SESSION_COOKIE = 'tt_session'

export const STATUSES = ['backlog', 'todo', 'in_progress', 'blocked', 'done'] as const
export const TYPES = ['bug', 'feature', 'chore'] as const
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const MD_FIELDS = ['description', 'requirement', 'prerequisites', 'result', 'notes'] as const

export type Status = (typeof STATUSES)[number]

export type Project = { id: string; name: string; slug: string; archived: boolean }

export type Task = {
  id: string
  projectId: string
  title: string
  description: string
  requirement: string
  prerequisites: string
  result: string
  notes: string
  type: (typeof TYPES)[number]
  status: Status
  priority: (typeof PRIORITIES)[number]
  assignee: string
  labels: string[]
  order: number
  updatedAt: string
}

/** The writable subset. `projectId` is absent by design: tasks never move projects. */
export type TaskInput = Omit<Task, 'id' | 'projectId' | 'updatedAt'>

export type LogEntry = {
  id: string; taskId: string; author: string; body: string; createdAt: string
}
```

- [ ] **Step 6: Write the Appwrite client factories**

Create `lib/appwrite.ts`:

```ts
import { Client } from 'node-appwrite'

export const DB = process.env.APPWRITE_DATABASE_ID!

function base() {
  return new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
}

/** Full-privilege client. Used by /api routes and anything key-authenticated. */
export function serverClient() {
  return base().setKey(process.env.APPWRITE_API_KEY!)
}

/** Acts as the logged-in human, using the session secret from their cookie. */
export function sessionClient(secret: string) {
  return base().setSession(secret)
}

/** No credentials. Only for creating a session at login. */
export function anonClient() {
  return base()
}
```

- [ ] **Step 7: Write the auth helpers**

Create `lib/auth.ts`:

```ts
import { cookies } from 'next/headers'
import { Account } from 'node-appwrite'
import { sessionClient } from './appwrite'
import { SESSION_COOKIE } from './shared'

export { SESSION_COOKIE }

export type Caller = { kind: 'user' | 'key'; name: string }

/** The logged-in human, or null. Never throws on a stale cookie. */
export async function currentUser() {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value
  if (!secret) return null
  try {
    const user = await new Account(sessionClient(secret)).get()
    return { name: user.name || user.email, email: user.email }
  } catch {
    return null
  }
}
```

- [ ] **Step 8: Write the login page and actions**

Create `app/login/actions.ts`:

```ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Account } from 'node-appwrite'
import { anonClient, sessionClient } from '@/lib/appwrite'
import { SESSION_COOKIE } from '@/lib/auth'

export async function login(_prev: string | null, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return 'Email and password are required.'

  let secret: string, expire: string
  try {
    const session = await new Account(anonClient())
      .createEmailPasswordSession(email, password)
    secret = session.secret
    expire = session.expire
  } catch {
    // Deliberately not distinguishing unknown-email from wrong-password.
    return 'Invalid email or password.'
  }

  ;(await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expire),
  })
  redirect('/')
}

export async function logout() {
  const jar = await cookies()
  const secret = jar.get(SESSION_COOKIE)?.value
  if (secret) {
    try { await new Account(sessionClient(secret)).deleteSession('current') } catch {}
  }
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}
```

Create `app/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { login } from './actions'

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)
  return (
    <main className="mx-auto mt-32 w-full max-w-sm px-6">
      <h1 className="mb-6 text-xl font-semibold">Task Tracker</h1>
      <form action={action} className="space-y-3">
        <input name="email" type="email" placeholder="Email" required
          className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" placeholder="Password" required
          className="w-full rounded border px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded bg-black py-2 text-white disabled:opacity-50">
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 9: Write the middleware**

Create `middleware.ts` at the project root. It checks only for the cookie's presence — validating the secret requires a network call, which is the page's job. A forged cookie gets past middleware and then fails at `currentUser()`, which returns null and redirects.

It imports `SESSION_COOKIE` from `lib/shared`, **not** from `lib/auth`. Middleware runs in the edge runtime, and `lib/auth` imports `node-appwrite`, which does not run there.

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/shared'

export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  return NextResponse.redirect(new URL('/login', req.url))
}

// Everything except /login, /api/* (key-authenticated), and static assets.
export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 10: Replace the scaffold home page with an authenticated stub**

Overwrite `app/page.tsx` — Task 3 fills it in properly:

```tsx
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { logout } from './login/actions'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return (
    <main className="p-8">
      <p>Signed in as {user.name}</p>
      <form action={logout}><button className="underline">Sign out</button></form>
    </main>
  )
}
```

- [ ] **Step 11: Verify the login flow by hand**

Create a user in the Appwrite console under Auth first, if you have not already.

```bash
npm run dev
```

Check all four, in order:
1. Visit `http://localhost:3000/` → redirected to `/login`.
2. Submit a wrong password → "Invalid email or password.", still on `/login`.
3. Submit the correct credentials → redirected to `/`, showing "Signed in as …".
4. In devtools → Application → Cookies, `tt_session` shows **HttpOnly ✓**. Then run `document.cookie` in the console: `tt_session` must **not** appear. That is the whole point of this task.

Then click "Sign out" → back to `/login`, and `/` redirects again.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: Appwrite clients, httpOnly session auth, login and route protection"
```

---

### Task 3: Projects — data layer and project list screen

**Files:**
- Create: `lib/db.ts`
- Create: `app/actions.ts`
- Modify: `app/page.tsx` (replace the Task 2 stub)

**Interfaces:**
- Consumes: `serverClient()`, `DB` from `lib/appwrite.ts`; `currentUser()` from `lib/auth.ts`.
- Produces, from `lib/db.ts`:
  - `listProjects(): Promise<Project[]>` — all projects, non-archived first, each group by name
  - `getProjectBySlug(slug: string): Promise<Project | null>`
  - `createProject(name: string): Promise<Project>` — slug derived from name
  - `setArchived(id: string, archived: boolean): Promise<void>`
  - `slugify(name: string): string`

- [ ] **Step 1: Write the data layer**

Create `lib/db.ts`. Every later task adds to this file; it starts with projects.

```ts
import { Databases, ID, Query, type Models } from 'node-appwrite'
import { serverClient, DB } from './appwrite'

// NOTE: written against node-appwrite's `Databases` API. If the installed SDK
// exposes `TablesDB` instead, see Task 1 Step 2 for the name translation.
const db = () => new Databases(serverClient())

import type { Project } from './shared'
export type { Project }

const toProject = (d: Models.Document): Project => ({
  id: d.$id,
  name: d.name as string,
  slug: d.slug as string,
  archived: Boolean(d.archived),
})

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

export async function listProjects(): Promise<Project[]> {
  const res = await db().listDocuments(DB, 'projects', [
    Query.orderAsc('name'),
    Query.limit(100),
  ])
  const all = res.documents.map(toProject)
  // Archived sort below the rest, per the spec.
  return [...all.filter(p => !p.archived), ...all.filter(p => p.archived)]
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const res = await db().listDocuments(DB, 'projects', [Query.equal('slug', slug), Query.limit(1)])
  return res.documents[0] ? toProject(res.documents[0]) : null
}

export async function createProject(name: string): Promise<Project> {
  const doc = await db().createDocument(DB, 'projects', ID.unique(), {
    name,
    slug: slugify(name),
    archived: false,
  })
  return toProject(doc)
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  await db().updateDocument(DB, 'projects', id, { archived })
}
```

- [ ] **Step 2: Write the project server actions**

Create `app/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createProject, setArchived, slugify, getProjectBySlug } from '@/lib/db'

// Every server action re-checks the session. Middleware only checks that a
// cookie exists; this is where a forged or expired one is actually rejected.
async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

export async function addProject(formData: FormData) {
  await requireUser()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  if (!slugify(name)) return            // e.g. a name of only punctuation
  if (await getProjectBySlug(slugify(name))) return   // slug is unique-indexed
  await createProject(name)
  revalidatePath('/')
}

export async function toggleArchived(formData: FormData) {
  await requireUser()
  const id = String(formData.get('id'))
  const archived = String(formData.get('archived')) === 'true'
  await setArchived(id, archived)
  revalidatePath('/')
}
```

- [ ] **Step 3: Write the project list page**

Overwrite `app/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listProjects } from '@/lib/db'
import { logout } from './login/actions'
import { addProject, toggleArchived } from './actions'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const projects = await listProjects()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/settings/keys" className="underline">API keys</Link>
          <form action={logout}><button className="underline">Sign out</button></form>
        </div>
      </header>

      <form action={addProject} className="mb-6 flex gap-2">
        <input name="name" placeholder="New project name" required
          className="flex-1 rounded border px-3 py-2" />
        <button className="rounded bg-black px-4 text-white">Add</button>
      </form>

      <ul className="divide-y">
        {projects.map(p => (
          <li key={p.id} className="flex items-center justify-between py-3">
            <Link href={`/p/${p.slug}`}
              className={p.archived ? 'text-gray-400 line-through' : 'font-medium'}>
              {p.name}
            </Link>
            <form action={toggleArchived}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="archived" value={String(!p.archived)} />
              <button className="text-xs text-gray-500 underline">
                {p.archived ? 'Unarchive' : 'Archive'}
              </button>
            </form>
          </li>
        ))}
        {projects.length === 0 && (
          <li className="py-6 text-sm text-gray-500">No projects yet.</li>
        )}
      </ul>
    </main>
  )
}
```

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

1. Log in, land on `/`.
2. Add a project named "Task Tracker" → it appears in the list.
3. Add a second project with the same name → nothing happens, no crash, no duplicate. (The unique slug index is doing its job and `addProject` checks before writing.)
4. Archive one → it moves to the bottom, greyed and struck through.
5. Unarchive it → it moves back up.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: project data layer and project list screen"
```

---

### Task 4: Tasks — order arithmetic and data layer

**Files:**
- Create: `lib/order.mjs`, `test/order.test.mjs`
- Modify: `lib/db.ts` (append the task functions)

**Interfaces:**
- Consumes: `db()`, `DB`, `getProjectBySlug` from earlier in `lib/db.ts`.
- Produces:
  - `lib/order.mjs`: `orderBetween(before: number|null, after: number|null): number`
  - `lib/db.ts`:
    - re-exports of `STATUSES`, `TYPES`, `PRIORITIES`, `MD_FIELDS`, `Task`, `TaskInput` from `lib/shared.ts`
    - `listTasks(opts): Promise<Task[]>` where `opts = { projectId, status?, assignee?, type?, label?, limit? }`
    - `getTask(id: string): Promise<Task | null>`
    - `createTask(projectId: string, input: TaskInput): Promise<Task>`
    - `updateTask(id: string, patch: Partial<TaskInput>): Promise<Task>`
    - `bottomOrder(projectId: string, status: string): Promise<number>`

- [ ] **Step 1: Write the failing test for order arithmetic**

Create `test/order.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderBetween } from '../lib/order.mjs'

test('into an empty column', () => {
  assert.equal(orderBetween(null, null), 0)
})

test('above the first card', () => {
  assert.equal(orderBetween(null, 5), 4)
})

test('below the last card', () => {
  assert.equal(orderBetween(5, null), 6)
})

test('between two cards takes the midpoint', () => {
  assert.equal(orderBetween(2, 4), 3)
  assert.equal(orderBetween(0, 1), 0.5)
})

test('repeated insertion into the same gap keeps producing distinct values', () => {
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = orderBetween(lo, hi)
    assert.ok(mid > lo && mid < hi, `iteration ${i}: ${mid} not strictly between ${lo} and ${hi}`)
    hi = mid
  }
})
```

That last test is the one worth having. It is the property the float scheme depends on, and it is exactly what fails when precision runs out.

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test test/order.test.mjs
```

Expected: FAIL — cannot find module `../lib/order.mjs`.

- [ ] **Step 3: Implement the order helper**

Create `lib/order.mjs`:

```js
/**
 * Position for a card dropped between two neighbours.
 * ponytail: float midpoints, no reindexing on drop. After roughly 50
 * consecutive insertions into the same gap the midpoint stops being strictly
 * between its neighbours and cards start colliding. Fix then, not now: a
 * renumber pass over the column (0, 1, 2, …) on write.
 *
 * @param {number|null} before order of the card above, null if dropped at top
 * @param {number|null} after  order of the card below, null if dropped at bottom
 * @returns {number}
 */
export function orderBetween(before, after) {
  if (before === null && after === null) return 0
  if (before === null) return after - 1
  if (after === null) return before + 1
  return (before + after) / 2
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node --test test/order.test.mjs
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Append the task functions to `lib/db.ts`**

Add to the imports at the top of the file, then append the rest:

```ts
import { orderBetween } from './order.mjs'
import { STATUSES, MD_FIELDS, type Status, type Task, type TaskInput } from './shared'

// Re-exported so server-side callers have one import site. Client components
// and middleware must import these from './shared' directly instead.
export { STATUSES, TYPES, PRIORITIES, MD_FIELDS } from './shared'
export type { Status, Task, TaskInput, Project, LogEntry } from './shared'

const toTask = (d: Models.Document): Task => ({
  id: d.$id,
  projectId: d.projectId as string,
  title: d.title as string,
  description: (d.description as string) ?? '',
  requirement: (d.requirement as string) ?? '',
  prerequisites: (d.prerequisites as string) ?? '',
  result: (d.result as string) ?? '',
  notes: (d.notes as string) ?? '',
  type: d.type as Task['type'],
  status: d.status as Status,
  priority: d.priority as Task['priority'],
  assignee: (d.assignee as string) ?? '',
  labels: (d.labels as string[]) ?? [],
  order: d.order as number,
  updatedAt: d.$updatedAt,
})

export type TaskFilter = {
  projectId: string
  status?: Status[]
  assignee?: string
  type?: string[]
  label?: string
  limit?: number
}

export async function listTasks(f: TaskFilter): Promise<Task[]> {
  const q = [Query.equal('projectId', f.projectId), Query.orderAsc('order')]
  if (f.status?.length) q.push(Query.equal('status', f.status))
  if (f.type?.length) q.push(Query.equal('type', f.type))
  if (f.assignee) q.push(Query.equal('assignee', f.assignee))
  if (f.label) q.push(Query.contains('labels', f.label))
  q.push(Query.limit(f.limit ?? 100))
  const res = await db().listDocuments(DB, 'tasks', q)
  const tasks = res.documents.map(toTask)
  // Group by status in the canonical column order, ordered within each column.
  return tasks.sort((a, b) =>
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.order - b.order)
}

export async function getTask(id: string): Promise<Task | null> {
  try {
    return toTask(await db().getDocument(DB, 'tasks', id))
  } catch {
    return null
  }
}

/** One past the last card in a column, so new tasks land at the bottom. */
export async function bottomOrder(projectId: string, status: Status): Promise<number> {
  const res = await db().listDocuments(DB, 'tasks', [
    Query.equal('projectId', projectId),
    Query.equal('status', status),
    Query.orderDesc('order'),
    Query.limit(1),
  ])
  const last = res.documents[0]
  return orderBetween(last ? (last.order as number) : null, null)
}

export async function createTask(projectId: string, input: Partial<TaskInput> & { title: string }) {
  const status = (input.status ?? 'backlog') as Status
  const doc = await db().createDocument(DB, 'tasks', ID.unique(), {
    projectId,
    title: input.title,
    description: input.description ?? '',
    requirement: input.requirement ?? '',
    prerequisites: input.prerequisites ?? '',
    result: input.result ?? '',
    notes: input.notes ?? '',
    type: input.type ?? 'feature',
    status,
    priority: input.priority ?? 'medium',
    assignee: input.assignee ?? '',
    labels: input.labels ?? [],
    order: input.order ?? (await bottomOrder(projectId, status)),
  })
  return toTask(doc)
}

/**
 * Partial update. Only keys present in `patch` are sent to Appwrite, which is
 * what stops a caller writing `result` from clobbering a `requirement` it
 * never read.
 */
export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Task> {
  const allowed: (keyof TaskInput)[] = [
    'title', 'description', 'requirement', 'prerequisites', 'result', 'notes',
    'type', 'status', 'priority', 'assignee', 'labels', 'order',
  ]
  const body: Record<string, unknown> = {}
  for (const k of allowed) if (k in patch) body[k] = patch[k]
  return toTask(await db().updateDocument(DB, 'tasks', id, body))
}
```

- [ ] **Step 6: Verify the partial-update guarantee against real Appwrite**

This is the single most important behaviour in the data layer, and it is worth proving before any UI depends on it. Create `test/partial-update.mjs` (a script, not a `node --test` file, because it needs the Next.js environment to resolve `@/`):

```js
// Run with: npx tsx test/partial-update.mjs   (or node --experimental-strip-types)
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { getProjectBySlug, createProject, createTask, updateTask, getTask } = await import('../lib/db.ts')
import assert from 'node:assert/strict'

const project = (await getProjectBySlug('scratch')) ?? (await createProject('Scratch'))
const t = await createTask(project.id, {
  title: 'partial update probe',
  requirement: 'MUST SURVIVE',
  description: 'ALSO MUST SURVIVE',
})
await updateTask(t.id, { result: 'written alone' })
const after = await getTask(t.id)
assert.equal(after.requirement, 'MUST SURVIVE')
assert.equal(after.description, 'ALSO MUST SURVIVE')
assert.equal(after.result, 'written alone')
console.log('partial update preserves sibling fields ✓')
```

Run it:

```bash
npm install -D tsx
npx tsx test/partial-update.mjs
```

Expected: `partial update preserves sibling fields ✓`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: task data layer with float ordering and partial updates"
```

---

### Task 5: The board screen with drag-and-drop

**Files:**
- Create: `app/p/[slug]/page.tsx`, `app/p/[slug]/board.tsx`, `app/p/[slug]/actions.ts`
- Create: `components/refresh-on-focus.tsx`

**Interfaces:**
- Consumes: `listTasks`, `getProjectBySlug`, `createTask`, `updateTask`, `STATUSES`, `Task` from `lib/db.ts`; `orderBetween` from `lib/order.mjs`.
- Produces: `app/p/[slug]/actions.ts` exporting `moveTask(taskId, status, order)`, `quickAddTask(formData)`.

- [ ] **Step 1: Write the board server actions**

Create `app/p/[slug]/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createTask, updateTask, getProjectBySlug, type Status } from '@/lib/db'

async function requireUser() {
  if (!(await currentUser())) redirect('/login')
}

export async function moveTask(slug: string, taskId: string, status: Status, order: number) {
  await requireUser()
  await updateTask(taskId, { status, order })
  revalidatePath(`/p/${slug}`)
}

export async function quickAddTask(slug: string, formData: FormData) {
  await requireUser()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return
  const project = await getProjectBySlug(slug)
  if (!project) return
  await createTask(project.id, {
    title,
    status: String(formData.get('status')) as Status,
  })
  revalidatePath(`/p/${slug}`)
}
```

- [ ] **Step 2: Write the refresh-on-focus component**

Create `components/refresh-on-focus.tsx`. This is the realtime replacement from the spec.

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ponytail: polling, not realtime. Appwrite's realtime needs credentials in
 * the browser, which the SSR design forbids. Upgrade path if this feels
 * stale: an SSE route where the server holds the Appwrite subscription.
 */
export function RefreshOnFocus({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => { if (!document.hidden) router.refresh() }
    const id = setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, intervalMs])
  return null
}
```

- [ ] **Step 3: Write the board client component**

Create `app/p/[slug]/board.tsx`. Native HTML5 drag-and-drop — no library.

```tsx
'use client'

import Link from 'next/link'
import { useOptimistic, useTransition, useState } from 'react'
import { orderBetween } from '@/lib/order.mjs'
// From '@/lib/shared', never '@/lib/db' — this is a client component, and
// lib/db imports node-appwrite. See Task 11 Step 6, which verifies this.
import { STATUSES, type Status, type Task } from '@/lib/shared'
import { moveTask, quickAddTask } from './actions'

const LABELS: Record<Status, string> = {
  backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
  blocked: 'Blocked', done: 'Done',
}
const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-gray-300', medium: 'bg-blue-400', high: 'bg-amber-500', urgent: 'bg-red-500',
}

export function Board({ slug, tasks }: { slug: string; tasks: Task[] }) {
  const [, startTransition] = useTransition()
  const [dragging, setDragging] = useState<string | null>(null)
  const [optimistic, applyMove] = useOptimistic(
    tasks,
    (state: Task[], m: { id: string; status: Status; order: number }) =>
      state.map(t => (t.id === m.id ? { ...t, status: m.status, order: m.order } : t))
  )

  const column = (s: Status) =>
    optimistic.filter(t => t.status === s).sort((a, b) => a.order - b.order)

  // `beforeId` is the card the drop landed on; the dragged card goes above it.
  // A drop on empty column space passes null and appends to the bottom.
  function drop(status: Status, beforeId: string | null) {
    const id = dragging
    if (!id) return
    setDragging(null)
    const col = column(status).filter(t => t.id !== id)
    const idx = beforeId ? col.findIndex(t => t.id === beforeId) : col.length
    const order = orderBetween(
      idx > 0 ? col[idx - 1].order : null,
      idx < col.length ? col[idx].order : null
    )
    startTransition(async () => {
      applyMove({ id, status, order })
      await moveTask(slug, id, status, order)
    })
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map(status => (
        <section
          key={status}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); drop(status, null) }}
          className="flex w-72 shrink-0 flex-col rounded-lg bg-gray-50 p-3"
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {LABELS[status]} <span className="text-gray-400">{column(status).length}</span>
          </h2>

          <div className="flex-1 space-y-2">
            {column(status).map(t => (
              <article
                key={t.id}
                draggable
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(status, t.id) }}
                className={`rounded border bg-white p-3 shadow-sm ${
                  dragging === t.id ? 'opacity-40' : ''
                }`}
              >
                <Link href={`/p/${slug}/t/${t.id}`} className="block text-sm font-medium">
                  {t.title}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                  <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority]}`}
                    title={t.priority} />
                  <span>{t.type}</span>
                  {t.assignee && <span>· {t.assignee}</span>}
                  {t.notes.trim() && (
                    <span title="Has notes to keep in mind" className="text-amber-600">⚑</span>
                  )}
                  {t.labels.map(l => (
                    <span key={l} className="rounded bg-gray-100 px-1.5 py-0.5">{l}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <form
            action={quickAddTask.bind(null, slug)}
            className="mt-2"
          >
            <input type="hidden" name="status" value={status} />
            <input
              name="title"
              placeholder="+ Add"
              className="w-full rounded border-none bg-transparent px-2 py-1.5 text-sm placeholder:text-gray-400 focus:bg-white focus:outline focus:outline-1"
            />
          </form>
        </section>
      ))}
    </div>
  )
}
```

The `⚑` marker on cards with a non-empty `notes` field is the spec's caveat indicator.

- [ ] **Step 4: Write the board page**

Create `app/p/[slug]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getProjectBySlug, listTasks } from '@/lib/db'
import { RefreshOnFocus } from '@/components/refresh-on-focus'
import { Board } from './board'

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await currentUser())) redirect('/login')

  const project = await getProjectBySlug(slug)
  if (!project) notFound()
  const tasks = await listTasks({ projectId: project.id, limit: 500 })

  return (
    <main className="p-6">
      <RefreshOnFocus />
      <header className="mb-6 flex items-baseline gap-3">
        <Link href="/" className="text-sm text-gray-500 underline">Projects</Link>
        <h1 className="text-xl font-semibold">{project.name}</h1>
      </header>
      <Board slug={slug} tasks={tasks} />
    </main>
  )
}
```

- [ ] **Step 5: Verify the board by hand**

```bash
npm run dev
```

1. Open a project → five columns render.
2. Type a title into "+ Add" under Todo and press Enter → the card appears in Todo.
3. Add two more to Todo.
4. Drag the bottom card onto the top card → it lands **above** it and stays there after a refresh.
5. Drag a card into In Progress → it moves, and stays after a refresh.
6. Drag a card onto empty space in Blocked → it appends to the bottom.
7. Open a second browser tab on the same board, move a card in tab A, switch to tab B → within 10 seconds (or immediately on focus) tab B shows the move. That is the polling replacement for realtime.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: kanban board with native drag-and-drop and focus polling"
```

---

### Task 6: Task detail with editable markdown sections

**Files:**
- Create: `components/markdown.tsx`, `app/p/[slug]/t/[id]/page.tsx`, `app/p/[slug]/t/[id]/detail.tsx`
- Modify: `app/p/[slug]/actions.ts` (add `saveField`, `saveScalars`)
- Modify: `app/globals.css` (markdown typography)

**Interfaces:**
- Consumes: `getTask`, `updateTask`, `MD_FIELDS`, `STATUSES`, `TYPES`, `PRIORITIES` from `lib/db.ts`.
- Produces: `saveField(slug, taskId, field, value)`, `saveScalars(slug, taskId, formData)` in `app/p/[slug]/actions.ts`; `<Markdown>{string}</Markdown>` from `components/markdown.tsx`.

- [ ] **Step 1: Write the markdown component**

Create `components/markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * rehype-raw is deliberately absent. Without it react-markdown never renders
 * embedded HTML and never touches dangerouslySetInnerHTML, so content written
 * by an API key cannot become script. Adding raw HTML here requires adding
 * sanitisation in the same change.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
```

Append to `app/globals.css`:

```css
.md { font-size: 0.875rem; line-height: 1.6; }
.md > * + * { margin-top: 0.75em; }
.md h1, .md h2, .md h3 { font-weight: 600; margin-top: 1.2em; }
.md h1 { font-size: 1.15rem } .md h2 { font-size: 1.05rem } .md h3 { font-size: 1rem }
.md ul { list-style: disc; padding-left: 1.25rem; }
.md ol { list-style: decimal; padding-left: 1.25rem; }
.md code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.85em; }
.md pre { background: #f3f4f6; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
.md pre code { background: none; padding: 0; }
.md table { border-collapse: collapse; width: 100%; }
.md th, .md td { border: 1px solid #e5e7eb; padding: 0.35rem 0.6rem; text-align: left; }
.md blockquote { border-left: 3px solid #e5e7eb; padding-left: 0.75rem; color: #6b7280; }
.md a { text-decoration: underline; }
.md input[type="checkbox"] { margin-right: 0.4rem; }
```

- [ ] **Step 2: Add the detail server actions**

Append to `app/p/[slug]/actions.ts`:

```ts
import { MD_FIELDS, STATUSES, TYPES, PRIORITIES, type TaskInput } from '@/lib/db'

export async function saveField(slug: string, taskId: string, field: string, value: string) {
  await requireUser()
  // Whitelist, not passthrough — `field` arrives from the client.
  if (!(MD_FIELDS as readonly string[]).includes(field) && field !== 'title') {
    throw new Error(`not a writable text field: ${field}`)
  }
  await updateTask(taskId, { [field]: value } as Partial<TaskInput>)
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}

export async function saveScalars(slug: string, taskId: string, formData: FormData) {
  await requireUser()
  const pick = <T extends readonly string[]>(name: string, allowed: T) => {
    const v = String(formData.get(name) ?? '')
    return (allowed as readonly string[]).includes(v) ? v : undefined
  }
  await updateTask(taskId, {
    status: pick('status', STATUSES) as TaskInput['status'],
    type: pick('type', TYPES) as TaskInput['type'],
    priority: pick('priority', PRIORITIES) as TaskInput['priority'],
    assignee: String(formData.get('assignee') ?? '').slice(0, 64),
    labels: String(formData.get('labels') ?? '')
      .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20),
  })
  revalidatePath(`/p/${slug}/t/${taskId}`)
  revalidatePath(`/p/${slug}`)
}
```

- [ ] **Step 3: Write the editable section component**

Create `app/p/[slug]/t/[id]/detail.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Markdown } from '@/components/markdown'
import { saveField } from '../../actions'

const PLACEHOLDER: Record<string, string> = {
  description: 'What is this task?',
  requirement: 'What does done look like?',
  prerequisites: 'What must be true before starting?',
  result: 'What actually happened?',
  notes: 'Caveats to keep in mind while working on anything else',
}

export function MarkdownField({
  slug, taskId, field, label, value,
}: { slug: string; taskId: string; field: string; label: string; value: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [pending, start] = useTransition()

  function commit() {
    setEditing(false)
    if (text === value) return
    start(() => { saveField(slug, taskId, field, text) })
  }

  return (
    <section className="mb-6">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}{pending && <span className="ml-2 font-normal normal-case">saving…</span>}
      </h3>
      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          rows={Math.max(4, text.split('\n').length + 1)}
          className="w-full rounded border p-2 font-mono text-sm"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[2rem] cursor-text rounded p-2 hover:bg-gray-50"
        >
          {text.trim()
            ? <Markdown>{text}</Markdown>
            : <span className="text-sm text-gray-400">{PLACEHOLDER[field]}</span>}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Write the task detail page**

Create `app/p/[slug]/t/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getTask, STATUSES, TYPES, PRIORITIES } from '@/lib/db'
import { saveScalars } from '../../actions'
import { MarkdownField } from './detail'

const FIELDS: [string, string][] = [
  ['description', 'Description'],
  ['requirement', 'Requirement'],
  ['prerequisites', 'Prerequisites'],
  ['result', 'Result'],
  ['notes', 'Notes'],
]

export default async function TaskPage(
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params
  if (!(await currentUser())) redirect('/login')
  const task = await getTask(id)
  if (!task) notFound()

  const select = (name: string, options: readonly string[], value: string) => (
    <select name={name} defaultValue={value} className="rounded border px-2 py-1 text-sm">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href={`/p/${slug}`} className="text-sm text-gray-500 underline">← Board</Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold">{task.title}</h1>

      <form action={saveScalars.bind(null, slug, task.id)}
        className="mb-8 flex flex-wrap items-center gap-2 rounded border bg-gray-50 p-3">
        {select('status', STATUSES, task.status)}
        {select('type', TYPES, task.type)}
        {select('priority', PRIORITIES, task.priority)}
        <input name="assignee" defaultValue={task.assignee} placeholder="Assignee"
          className="rounded border px-2 py-1 text-sm" />
        <input name="labels" defaultValue={task.labels.join(', ')} placeholder="labels, comma, separated"
          className="flex-1 rounded border px-2 py-1 text-sm" />
        <button className="rounded bg-black px-3 py-1 text-sm text-white">Save</button>
      </form>

      {FIELDS.map(([field, label]) => (
        <MarkdownField key={field} slug={slug} taskId={task.id}
          field={field} label={label} value={task[field as keyof typeof task] as string} />
      ))}
    </main>
  )
}
```

- [ ] **Step 5: Verify the detail screen by hand**

```bash
npm run dev
```

1. Click a card → detail page opens.
2. Click the empty Description area → a textarea appears, focused.
3. Type `## Heading` then `- [ ] a checkbox` and `| a | b |` table rows. Click outside → it renders as a heading, a checkbox and a table. (GFM is working.)
4. Reload → the content persisted.
5. Type `<script>alert(1)</script>` into Notes, click away → it renders as **literal text**, no dialog. This is the `rehype-raw` guarantee; if a dialog appears, the component is misconfigured and must be fixed before any API route can write these fields.
6. Fill in Notes on the task, go back to the board → the card shows the `⚑` marker.
7. Change status in the scalar form and Save → the card moves column on the board.
8. Edit only Result, reload → Description and Requirement are unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: task detail with click-to-edit markdown sections"
```

---

### Task 7: Work log

**Files:**
- Modify: `lib/db.ts` (append worklog functions)
- Modify: `app/p/[slug]/actions.ts` (add `addLogEntry`)
- Modify: `app/p/[slug]/t/[id]/page.tsx` (render the stream)

**Interfaces:**
- Consumes: `db()`, `DB`, `currentUser()`.
- Produces:
  - `lib/db.ts`: `type LogEntry = { id: string; taskId: string; author: string; body: string; createdAt: string }`, `listLog(taskId, limit?): Promise<LogEntry[]>`, `addLog(taskId, author, body): Promise<LogEntry>`
  - `app/p/[slug]/actions.ts`: `addLogEntry(slug, taskId, formData)`

- [ ] **Step 1: Append the worklog data functions to `lib/db.ts`**

```ts
import type { LogEntry } from './shared'

const toLog = (d: Models.Document): LogEntry => ({
  id: d.$id,
  taskId: d.taskId as string,
  author: d.author as string,
  body: d.body as string,
  createdAt: d.$createdAt,
})

/** Oldest first — the stream reads top to bottom as it happened. */
export async function listLog(taskId: string, limit = 50): Promise<LogEntry[]> {
  const res = await db().listDocuments(DB, 'worklog', [
    Query.equal('taskId', taskId),
    Query.orderAsc('$createdAt'),
    Query.limit(limit),
  ])
  return res.documents.map(toLog)
}

/** Append-only. There is deliberately no update or delete. */
export async function addLog(taskId: string, author: string, body: string): Promise<LogEntry> {
  return toLog(await db().createDocument(DB, 'worklog', ID.unique(), {
    taskId, author: author.slice(0, 64), body,
  }))
}

/** Most recent entries for many tasks at once, for /api/context. */
export async function recentLogByTask(taskIds: string[], perTask = 3) {
  if (taskIds.length === 0) return new Map<string, LogEntry[]>()
  const res = await db().listDocuments(DB, 'worklog', [
    Query.equal('taskId', taskIds),
    Query.orderDesc('$createdAt'),
    Query.limit(taskIds.length * perTask + 100),
  ])
  const map = new Map<string, LogEntry[]>()
  for (const doc of res.documents) {
    const e = toLog(doc)
    const list = map.get(e.taskId) ?? []
    if (list.length < perTask) { list.push(e); map.set(e.taskId, list) }
  }
  // Each task's entries came in newest-first; flip to chronological.
  for (const list of map.values()) list.reverse()
  return map
}
```

- [ ] **Step 2: Add the log server action**

Append to `app/p/[slug]/actions.ts`:

```ts
import { addLog } from '@/lib/db'

export async function addLogEntry(slug: string, taskId: string, formData: FormData) {
  const user = await currentUser()
  if (!user) redirect('/login')
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return
  await addLog(taskId, user.name, body)
  revalidatePath(`/p/${slug}/t/${taskId}`)
}
```

Note `requireUser()` is not reused here because the action needs the user's name, not just their existence.

- [ ] **Step 3: Render the stream on the detail page**

In `app/p/[slug]/t/[id]/page.tsx`, add to the imports:

```tsx
import { getTask, listLog, STATUSES, TYPES, PRIORITIES } from '@/lib/db'
import { saveScalars, addLogEntry } from '../../actions'
import { Markdown } from '@/components/markdown'
```

After `const task = await getTask(id)`:

```tsx
const log = await listLog(task.id)
```

And after the `FIELDS.map(...)` block, before `</main>`:

```tsx
<section className="mt-10 border-t pt-6">
  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
    Work log
  </h3>

  <ol className="mb-4 space-y-4">
    {log.map(e => (
      <li key={e.id}>
        <div className="text-[11px] text-gray-400">
          {e.author} · {new Date(e.createdAt).toLocaleString()}
        </div>
        <Markdown>{e.body}</Markdown>
      </li>
    ))}
    {log.length === 0 && <li className="text-sm text-gray-400">No entries yet.</li>}
  </ol>

  <form action={addLogEntry.bind(null, slug, task.id)} className="space-y-2">
    <textarea name="body" rows={3} placeholder="What happened?"
      className="w-full rounded border p-2 text-sm" />
    <button className="rounded bg-black px-3 py-1 text-sm text-white">Add entry</button>
  </form>
</section>
```

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

1. Open a task → "Work log — No entries yet."
2. Add an entry containing `**bold**` → it appears rendered bold, stamped with your name and the current time.
3. Add a second → it appears **below** the first (chronological, oldest at top).
4. Reload → both persist in the same order.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: append-only work log with UI stream"
```

---

### Task 8: API keys — data layer, caller resolution, settings screen

**Files:**
- Modify: `lib/db.ts` (append key functions)
- Modify: `lib/auth.ts` (add `resolveCaller`)
- Create: `app/settings/keys/page.tsx`, `app/settings/keys/actions.ts`, `app/settings/keys/mint-form.tsx`

**Interfaces:**
- Consumes: `generateKey`, `hashKey` from `lib/keys.mjs`; `currentUser` from `lib/auth.ts`.
- Produces:
  - `lib/db.ts`: `type ApiKey = { id: string; label: string; lastUsedAt: string | null; createdBy: string }`, `listKeys()`, `createKey(label, createdBy): Promise<{ key: string; record: ApiKey }>`, `revokeKey(id)`, `findKeyByHash(hash): Promise<ApiKey | null>`, `touchKey(id)`
  - `lib/auth.ts`: `resolveCaller(req: Request): Promise<Caller | null>`

- [ ] **Step 1: Append the key data functions to `lib/db.ts`**

```ts
import { generateKey, hashKey } from './keys.mjs'

export type ApiKey = {
  id: string; label: string; lastUsedAt: string | null; createdBy: string; createdAt: string
}

const toKey = (d: Models.Document): ApiKey => ({
  id: d.$id,
  label: d.label as string,
  lastUsedAt: (d.lastUsedAt as string) ?? null,
  createdBy: d.createdBy as string,
  createdAt: d.$createdAt,
})

export async function listKeys(): Promise<ApiKey[]> {
  const res = await db().listDocuments(DB, 'api_keys', [
    Query.orderDesc('$createdAt'), Query.limit(100),
  ])
  return res.documents.map(toKey)
}

/** The plaintext key is returned once here and never stored. */
export async function createKey(label: string, createdBy: string) {
  const key = generateKey()
  const doc = await db().createDocument(DB, 'api_keys', ID.unique(), {
    label: label.slice(0, 64), hash: hashKey(key), createdBy,
  })
  return { key, record: toKey(doc) }
}

export async function revokeKey(id: string) {
  await db().deleteDocument(DB, 'api_keys', id)
}

export async function findKeyByHash(hash: string): Promise<ApiKey | null> {
  const res = await db().listDocuments(DB, 'api_keys', [Query.equal('hash', hash), Query.limit(1)])
  return res.documents[0] ? toKey(res.documents[0]) : null
}

export async function touchKey(id: string) {
  try {
    await db().updateDocument(DB, 'api_keys', id, { lastUsedAt: new Date().toISOString() })
  } catch {
    // Recording last-use must never fail a request that already authenticated.
  }
}
```

- [ ] **Step 2: Add `resolveCaller` to `lib/auth.ts`**

```ts
import { hashKey } from './keys.mjs'
import { findKeyByHash, touchKey } from './db'

/**
 * Turns either front door into one identity. API key wins when both are
 * present, so a browser-originated call carrying a key is still treated as
 * that key. Returns null when neither authenticates.
 */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const presented = req.headers.get('x-api-key')
  if (presented) {
    const record = await findKeyByHash(hashKey(presented))
    if (!record) return null
    await touchKey(record.id)
    return { kind: 'key', name: record.label }
  }
  const user = await currentUser()
  return user ? { kind: 'user', name: user.name } : null
}
```

- [ ] **Step 3: Write the key settings actions**

Create `app/settings/keys/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { createKey, revokeKey } from '@/lib/db'

export async function mintKey(_prev: string | null, formData: FormData) {
  const user = await currentUser()
  if (!user) redirect('/login')
  const label = String(formData.get('label') ?? '').trim()
  if (!label) return null
  const { key } = await createKey(label, user.name)
  revalidatePath('/settings/keys')
  return key   // shown once, by the page; never stored in plaintext
}

export async function removeKey(formData: FormData) {
  if (!(await currentUser())) redirect('/login')
  await revokeKey(String(formData.get('id')))
  revalidatePath('/settings/keys')
}
```

- [ ] **Step 4: Write the key settings page**

Create `app/settings/keys/page.tsx`. The create form is a client component so the one-time key can be shown in the response.

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listKeys } from '@/lib/db'
import { removeKey } from './actions'
import { MintForm } from './mint-form'

export default async function KeysPage() {
  if (!(await currentUser())) redirect('/login')
  const keys = await listKeys()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm text-gray-500 underline">← Projects</Link>
      <h1 className="mb-6 mt-3 text-xl font-semibold">API keys</h1>

      <MintForm />

      <ul className="mt-8 divide-y">
        {keys.map(k => (
          <li key={k.id} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium">{k.label}</div>
              <div className="text-xs text-gray-500">
                created by {k.createdBy} ·{' '}
                {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}
              </div>
            </div>
            <form action={removeKey}>
              <input type="hidden" name="id" value={k.id} />
              <button className="text-xs text-red-600 underline">Revoke</button>
            </form>
          </li>
        ))}
        {keys.length === 0 && <li className="py-6 text-sm text-gray-500">No keys yet.</li>}
      </ul>
    </main>
  )
}
```

Create `app/settings/keys/mint-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { mintKey } from './actions'

export function MintForm() {
  const [key, action, pending] = useActionState(mintKey, null)
  return (
    <>
      <form action={action} className="flex gap-2">
        <input name="label" placeholder="Label, e.g. claude-laptop" required
          className="flex-1 rounded border px-3 py-2" />
        <button disabled={pending} className="rounded bg-black px-4 text-white disabled:opacity-50">
          Create
        </button>
      </form>
      {key && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium text-amber-900">
            Copy this now — it is not stored and cannot be shown again.
          </p>
          <code className="block break-all rounded bg-white p-2 font-mono text-xs">{key}</code>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Verify by hand**

```bash
npm run dev
```

1. Visit `/settings/keys` → "No keys yet."
2. Create one labelled `claude-laptop` → a 64-character hex key appears in the amber box. **Copy it into `.env.local` as `TEST_API_KEY` now** — Task 9 needs it and it cannot be recovered.
3. Reload the page → the key list shows the label, but the key itself is gone from the screen.
4. In the Appwrite console, open the `api_keys` collection → the `hash` column holds a 64-char hex value that is **not** equal to the key you copied.
5. Revoke it, create a fresh one, and put that one in `.env.local`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: API key minting, revocation, and dual-front-door caller resolution"
```

---

### Task 9: The REST API

**Files:**
- Create: `app/api/_util.ts`
- Create: `app/api/projects/route.ts`, `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`, `app/api/tasks/[id]/log/route.ts`
- Create: `test-api.mjs`
- Modify: `package.json` (add the `test:api` script)

**Interfaces:**
- Consumes: everything in `lib/db.ts`; `resolveCaller` from `lib/auth.ts`.
- Produces: the HTTP contract in the spec. `app/api/_util.ts` exports `requireCaller(req)`, `bad(message, status)`, `json(data, status?)`.

- [ ] **Step 1: Write the failing contract test**

Create `test-api.mjs`. Write it complete now; the routes do not exist yet, so it fails.

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const KEY = process.env.TEST_API_KEY
assert.ok(KEY, 'TEST_API_KEY must be set in .env.local (mint one at /settings/keys)')

const api = async (path, init = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  const body = res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text
  return { status: res.status, body }
}

const check = (label, cond) => {
  assert.ok(cond, label)
  console.log('  ✓', label)
}

// --- auth ---------------------------------------------------------------
{
  const res = await fetch(BASE + '/api/projects')
  check('no key is rejected with 401', res.status === 401)
  const bad = await fetch(BASE + '/api/projects', { headers: { 'x-api-key': 'nope' } })
  check('a wrong key is rejected with 401', bad.status === 401)
}

// --- projects -----------------------------------------------------------
const { body: { projects } } = await api('/api/projects')
check('projects list returns an array', Array.isArray(projects))
const project = projects[0]
assert.ok(project, 'create at least one project in the UI before running this')

// --- create -------------------------------------------------------------
const stamp = Date.now()
const created = await api('/api/tasks', {
  method: 'POST',
  body: JSON.stringify({
    project: project.slug,
    title: `contract probe ${stamp}`,
    description: 'DESC',
    requirement: 'REQ',
    prerequisites: 'PRE',
    notes: 'CAVEAT: probe task, safe to delete',
    type: 'chore',
    priority: 'high',
    status: 'todo',
  }),
})
check('POST /api/tasks returns 201', created.status === 201)
const id = created.body.id
check('created task has an id', typeof id === 'string' && id.length > 0)
check('defaults and explicit values both applied',
  created.body.status === 'todo' && created.body.type === 'chore' && created.body.assignee === '')

// --- missing fields -----------------------------------------------------
{
  const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project: project.slug }) })
  check('POST without a title is a 400', r.status === 400)
  const r2 = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project: 'nope', title: 'x' }) })
  check('POST to an unknown project is a 404', r2.status === 404)
}

// --- list / filter ------------------------------------------------------
{
  const r = await api(`/api/tasks?project=${project.slug}&status=todo`)
  check('GET filters by status', r.body.tasks.some(t => t.id === id))
  const r2 = await api(`/api/tasks?project=${project.slug}&status=done`)
  check('GET excludes non-matching statuses', !r2.body.tasks.some(t => t.id === id))
  const r3 = await api(`/api/tasks?project=${project.slug}`)
  check('GET with no status filter returns every status', r3.body.tasks.some(t => t.id === id))
}

// --- partial update -----------------------------------------------------
{
  const r = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ result: 'RESULT ONLY' }),
  })
  check('PATCH returns 200', r.status === 200)
  check('PATCH wrote result', r.body.result === 'RESULT ONLY')
  check('PATCH left description untouched', r.body.description === 'DESC')
  check('PATCH left requirement untouched', r.body.requirement === 'REQ')
  check('PATCH left prerequisites untouched', r.body.prerequisites === 'PRE')
  check('PATCH left notes untouched', r.body.notes.startsWith('CAVEAT'))

  // projectId must be dropped, not honoured. Paired with a writable field so
  // the request is not rejected outright for having nothing to write.
  const moved = await api(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ projectId: 'somewhere-else', title: `contract probe ${stamp}` }),
  })
  check('PATCH cannot move a task between projects', moved.body.projectId === project.id)

  const nothing = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ projectId: 'somewhere-else' }),
  })
  check('PATCH with no writable field is a 400', nothing.status === 400)
}

// --- move between columns ----------------------------------------------
{
  const r = await api(`/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'in_progress', order: 1.5 }),
  })
  check('PATCH moves a task between columns',
    r.body.status === 'in_progress' && r.body.order === 1.5)
}

// --- work log -----------------------------------------------------------
{
  const r = await api(`/api/tasks/${id}/log`, {
    method: 'POST', body: JSON.stringify({ body: 'probe log entry' }),
  })
  check('POST log returns 201', r.status === 201)
  check('log author defaults to the API key label',
    typeof r.body.author === 'string' && r.body.author.length > 0)

  const empty = await api(`/api/tasks/${id}/log`, { method: 'POST', body: JSON.stringify({}) })
  check('POST log without a body is a 400', empty.status === 400)
}

// --- context ------------------------------------------------------------
{
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
  const r = await api(`/api/context?project=${project.slug}`)
  check('context returns markdown', typeof r.body === 'string' && r.body.includes('# '))
  check('context leads with Keep in mind', r.body.indexOf('Keep in mind') < r.body.indexOf('Open tasks'))
  check('a note on a DONE task still reaches Keep in mind',
    r.body.slice(r.body.indexOf('Keep in mind'), r.body.indexOf('Open tasks')).includes('CAVEAT'))
  check('a done task appears under Done with its result',
    r.body.slice(r.body.indexOf('## Done')).includes('RESULT ONLY'))
  check('context includes the task id for follow-up writes', r.body.includes(id))
}

console.log('\nall contract checks passed')
```

Add to `package.json` scripts:

```json
"test:api": "node test-api.mjs"
```

- [ ] **Step 2: Run it to verify it fails**

With `npm run dev` running in another terminal:

```bash
npm run test:api
```

Expected: FAIL on the very first check — `/api/projects` returns 404, not 401, because no route exists yet.

- [ ] **Step 3: Write the shared route helpers**

Create `app/api/_util.ts`:

```ts
import { NextResponse } from 'next/server'
import { resolveCaller, type Caller } from '@/lib/auth'

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** Returns the caller, or a 401 response to return directly. */
export async function requireCaller(req: Request): Promise<Caller | NextResponse> {
  const caller = await resolveCaller(req)
  return caller ?? bad('Unauthorized', 401)
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse
```

- [ ] **Step 4: Write the projects route**

Create `app/api/projects/route.ts`:

```ts
import { requireCaller, isResponse, json } from '../_util'
import { listProjects } from '@/lib/db'

export async function GET(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  const projects = (await listProjects()).filter(p => !p.archived)
  return json({ projects: projects.map(p => ({ id: p.id, name: p.name, slug: p.slug })) })
}
```

- [ ] **Step 5: Write the tasks collection route**

Create `app/api/tasks/route.ts`:

```ts
import { requireCaller, isResponse, json, bad } from '../_util'
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

  const tasks = await listTasks({
    projectId: project.id,
    status: status as Status[] | undefined,
    type,
    assignee: url.searchParams.get('assignee') ?? undefined,
    label: url.searchParams.get('label') ?? undefined,
    limit: Number(url.searchParams.get('limit')) || 100,
  })
  return json({ tasks })
}

export async function POST(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON')
  if (!body.project) return bad('project is required')
  if (!body.title?.trim()) return bad('title is required')

  const project = await getProjectBySlug(body.project)
  if (!project) return bad(`no such project: ${body.project}`, 404)

  for (const [field, allowed] of [
    ['status', STATUSES], ['type', TYPES], ['priority', PRIORITIES],
  ] as const) {
    if (body[field] && !(allowed as readonly string[]).includes(body[field]))
      return bad(`${field} must be one of: ${allowed.join(', ')}`)
  }

  const task = await createTask(project.id, body)
  return json(task, 201)
}
```

- [ ] **Step 6: Write the single-task route**

Create `app/api/tasks/[id]/route.ts`:

```ts
import { requireCaller, isResponse, json, bad } from '../../_util'
import { getTask, updateTask, STATUSES, TYPES, PRIORITIES, MD_FIELDS } from '@/lib/db'

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

  for (const [field, allowed] of [
    ['status', STATUSES], ['type', TYPES], ['priority', PRIORITIES],
  ] as const) {
    if (body[field] && !(allowed as readonly string[]).includes(body[field]))
      return bad(`${field} must be one of: ${allowed.join(', ')}`)
  }

  // Whitelist. Anything not writable — projectId above all — is dropped silently.
  const patch: Record<string, unknown> = {}
  for (const k of WRITABLE) if (k in body) patch[k] = body[k]
  if (Object.keys(patch).length === 0) return bad('no writable fields in body')

  return json(await updateTask(id, patch))
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  const task = await getTask((await ctx.params).id)
  return task ? json(task) : bad('no such task', 404)
}
```

- [ ] **Step 7: Write the work log route**

Create `app/api/tasks/[id]/log/route.ts`:

```ts
import { requireCaller, isResponse, json, bad } from '../../../_util'
import { getTask, addLog, listLog } from '@/lib/db'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const { id } = await ctx.params
  if (!(await getTask(id))) return bad('no such task', 404)

  const body = await req.json().catch(() => null)
  if (!body?.body?.trim()) return bad('body is required')

  // Author defaults to the caller identity: the key's label, or the user's name.
  const entry = await addLog(id, String(body.author ?? caller.name), body.body)
  return json(entry, 201)
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  return json({ entries: await listLog((await ctx.params).id) })
}
```

- [ ] **Step 8: Run the contract test**

```bash
npm run test:api
```

Expected: every check up to and including the work log passes. The **context** block still fails — `/api/context` is Task 10. Confirm the failure is `404` on `/api/context` and nothing earlier.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: REST API for projects, tasks, and work log"
```

---

### Task 10: `/api/context` — the session catch-up endpoint

**Files:**
- Create: `lib/context.mjs`, `test/context.test.mjs`
- Create: `app/api/context/route.ts`

**Interfaces:**
- Consumes: `Task`, `LogEntry` shapes (plain objects — `lib/context.mjs` imports nothing from the data layer, which is what makes it unit-testable).
- Produces: `renderContext({ project, tasks, logByTask }): string`

- [ ] **Step 1: Write the failing test**

Create `test/context.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderContext } from '../lib/context.mjs'

const task = (over = {}) => ({
  id: 't1', title: 'A task', description: '', requirement: '', prerequisites: '',
  result: '', notes: '', type: 'feature', status: 'todo', priority: 'medium',
  assignee: '', labels: [], order: 0, ...over,
})

const render = (tasks, logByTask = new Map()) =>
  renderContext({ project: { name: 'Demo', slug: 'demo' }, tasks, logByTask })

test('Keep in mind comes before Open tasks', () => {
  const out = render([task({ notes: 'watch out' })])
  assert.ok(out.indexOf('Keep in mind') < out.indexOf('Open tasks'))
})

test('notes from a done task still appear in Keep in mind', () => {
  const out = render([task({ status: 'done', notes: 'the migration is irreversible' })])
  const keep = out.slice(out.indexOf('Keep in mind'), out.indexOf('## Open tasks'))
  assert.ok(keep.includes('the migration is irreversible'))
  assert.ok(keep.includes('A task'), 'note is labelled with its task title')
})

test('tasks without notes contribute nothing to Keep in mind', () => {
  const out = render([task({ title: 'Quiet' })])
  assert.ok(!out.includes('Keep in mind'))
})

test('empty markdown fields are omitted, present ones are labelled', () => {
  const out = render([task({ description: 'the what', requirement: '' })])
  assert.ok(out.includes('the what'))
  assert.ok(!out.includes('Requirement'))
})

test('done tasks are titles plus result, not full bodies', () => {
  const out = render([task({
    status: 'done', title: 'Shipped', description: 'LONG BODY', result: 'it works',
  })])
  const done = out.slice(out.indexOf('## Done'))
  assert.ok(done.includes('Shipped'))
  assert.ok(done.includes('it works'))
  assert.ok(!done.includes('LONG BODY'))
})

test('open tasks are grouped under their status headings', () => {
  const out = render([
    task({ id: 'a', title: 'First', status: 'in_progress' }),
    task({ id: 'b', title: 'Second', status: 'blocked' }),
  ])
  assert.ok(out.indexOf('In Progress') < out.indexOf('Blocked'))
  assert.ok(out.indexOf('First') < out.indexOf('Second'))
})

test('recent work log entries are included for open tasks', () => {
  const log = new Map([['t1', [{ author: 'claude', body: 'tried X', createdAt: '2026-09-10T10:00:00Z' }]]])
  const out = render([task()], log)
  assert.ok(out.includes('tried X'))
  assert.ok(out.includes('claude'))
})

test('an empty board still renders a valid document', () => {
  const out = render([])
  assert.ok(out.startsWith('# Demo'))
  assert.ok(out.includes('No open tasks'))
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test test/context.test.mjs
```

Expected: FAIL — cannot find module `../lib/context.mjs`.

- [ ] **Step 3: Implement the renderer**

Create `lib/context.mjs`:

```js
const OPEN = ['in_progress', 'blocked', 'todo', 'backlog']
const HEADING = {
  in_progress: 'In Progress', blocked: 'Blocked', todo: 'Todo', backlog: 'Backlog',
}
const BODY_FIELDS = [
  ['description', 'Description'],
  ['requirement', 'Requirement'],
  ['prerequisites', 'Prerequisites'],
]

/**
 * The whole board as one markdown document for an agent to read at the start
 * of a session. Pure: takes plain objects, returns a string, touches nothing.
 *
 * @param {{project: {name: string, slug: string},
 *          tasks: Array<object>,
 *          logByTask: Map<string, Array<{author: string, body: string, createdAt: string}>>}} input
 * @returns {string}
 */
export function renderContext({ project, tasks, logByTask = new Map() }) {
  const out = [`# ${project.name}`, '']

  // 1. Keep in mind — every note, every status, done included. Leads the
  //    document because its purpose is to be read while working elsewhere.
  const noted = tasks.filter(t => t.notes && t.notes.trim())
  if (noted.length) {
    out.push('## Keep in mind', '')
    for (const t of noted) {
      out.push(`### ${t.title}${t.status === 'done' ? ' (done)' : ''}`, '', t.notes.trim(), '')
    }
  }

  // 2. Open tasks, grouped by status in working order.
  out.push('## Open tasks', '')
  const open = tasks.filter(t => OPEN.includes(t.status))
  if (open.length === 0) {
    out.push('No open tasks.', '')
  } else {
    for (const status of OPEN) {
      const group = open.filter(t => t.status === status).sort((a, b) => a.order - b.order)
      if (!group.length) continue
      out.push(`### ${HEADING[status]}`, '')
      for (const t of group) {
        const meta = [t.type, t.priority, t.assignee || null, ...(t.labels || [])]
          .filter(Boolean).join(' · ')
        out.push(`#### ${t.title}`, '', `\`${t.id}\` — ${meta}`, '')
        for (const [field, label] of BODY_FIELDS) {
          if (t[field] && t[field].trim()) {
            out.push(`**${label}:**`, '', t[field].trim(), '')
          }
        }
        for (const entry of logByTask.get(t.id) || []) {
          out.push(`> *${entry.author}, ${entry.createdAt}* — ${entry.body.trim()}`, '')
        }
      }
    }
  }

  // 3. Done — titles and results only. Full bodies of finished work are noise.
  const done = tasks.filter(t => t.status === 'done')
  if (done.length) {
    out.push('## Done', '')
    for (const t of done) {
      out.push(t.result && t.result.trim()
        ? `- **${t.title}** — ${t.result.trim().replace(/\n+/g, ' ')}`
        : `- **${t.title}**`)
    }
    out.push('')
  }

  return out.join('\n')
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node --test test/context.test.mjs
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the context route**

Create `app/api/context/route.ts`:

```ts
import { requireCaller, isResponse, bad } from '../_util'
import { getProjectBySlug, listTasks, recentLogByTask } from '@/lib/db'
import { renderContext } from '@/lib/context.mjs'

export async function GET(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const slug = new URL(req.url).searchParams.get('project')
  if (!slug) return bad('project is required')
  const project = await getProjectBySlug(slug)
  if (!project) return bad(`no such project: ${slug}`, 404)

  const tasks = await listTasks({ projectId: project.id, limit: 500 })
  const open = tasks.filter(t => t.status !== 'done')
  const logByTask = await recentLogByTask(open.map(t => t.id))

  return new Response(renderContext({ project, tasks, logByTask }), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  })
}
```

- [ ] **Step 6: Run the full contract test**

```bash
npm run test:api
```

Expected: every check passes, ending in `all contract checks passed`.

- [ ] **Step 7: Read the output with your own eyes**

The tests prove structure, not usefulness. This endpoint exists to be read by an agent, so read it:

```bash
curl -s -H "x-api-key: $TEST_API_KEY" \
  "http://localhost:3000/api/context?project=<your-slug>"
```

Judge it as a briefing document: are the caveats at the top the things you would actually want flagged? Is anything important missing, or is it padded with noise? Adjust `lib/context.mjs` if so — this is the one place where taste matters more than assertions.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: /api/context session catch-up endpoint"
```

---

### Task 11: Cross-door equivalence and the finishing pass

**Files:**
- Modify: `test-api.mjs` (add the cookie-vs-key block)
- Create: `app/api/login/route.ts`, `README.md`
- Modify: `package.json` (add `test` running both harnesses)

**Interfaces:**
- Consumes: everything.
- Produces: a verified system and the operating instructions for it.

- [ ] **Step 1: Write the failing cross-door check**

This is the property the whole SSR architecture exists to guarantee: the same operation through the browser's cookie and through an API key must land in exactly the same place. Append to `test-api.mjs`, before the final `console.log`:

```js
// --- both front doors agree ---------------------------------------------
if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
  // Log in the way a browser does and keep the Set-Cookie.
  const form = new URLSearchParams({
    email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD,
  })
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  check('cookie login succeeded', login.status === 200 && cookie?.startsWith('tt_session='))

  const viaCookie = await fetch(`${BASE}/api/tasks?project=${project.slug}`, {
    headers: { cookie },
  })
  const cookieBody = await viaCookie.json()
  const viaKey = await api(`/api/tasks?project=${project.slug}`)

  check('cookie caller is accepted by /api', viaCookie.status === 200)
  check('cookie and key see identical task lists',
    JSON.stringify(cookieBody.tasks.map(t => t.id).sort()) ===
    JSON.stringify(viaKey.body.tasks.map(t => t.id).sort()))

  // And a write through the cookie is visible through the key.
  const w = await fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'cookie-writer' }),
  })
  check('cookie caller can write', w.status === 200)
  const readBack = await api(`/api/tasks/${id}`)
  check('a cookie write is visible to a key read', readBack.body.assignee === 'cookie-writer')
} else {
  console.log('  – skipped cross-door checks (set TEST_EMAIL and TEST_PASSWORD)')
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:api
```

Expected: FAIL — `/api/login` returns 404. The browser login flow is a server action, which a script cannot invoke, so a non-browser client needs a route that performs the same exchange.

- [ ] **Step 3: Add the login route the test needs**

This is a real route, not test scaffolding: it is the endpoint any non-browser client uses to obtain a session. Create `app/api/login/route.ts`:

```ts
import { Account } from 'node-appwrite'
import { anonClient } from '@/lib/appwrite'
import { SESSION_COOKIE } from '@/lib/auth'
import { bad } from '../_util'

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || !password) return bad('email and password are required')

  let secret: string, expire: string
  try {
    const s = await new Account(anonClient()).createEmailPasswordSession(email, password)
    secret = s.secret
    expire = s.expire
  } catch {
    return bad('Invalid email or password', 401)
  }

  const res = new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
  res.headers.append('set-cookie',
    `${SESSION_COOKIE}=${secret}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expire).toUTCString()}` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : ''))
  return res
}
```

- [ ] **Step 4: Fill in the test credentials and run everything**

Put `TEST_EMAIL` and `TEST_PASSWORD` in `.env.local` (the Appwrite user you created in Task 2).

Add to `package.json` scripts:

```json
"test": "node --test test/*.test.mjs && node test-api.mjs"
```

Then, with `npm run dev` running:

```bash
npm test
```

Expected: the unit tests pass (16 across three files), then every contract check passes, ending in `all contract checks passed`. **No check may be skipped** — if the cross-door block prints "skipped", the credentials are missing and the most important property in the system is unverified.

- [ ] **Step 5: Write the README**

Create `README.md`:

````markdown
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
| POST | `/api/login` | Exchange credentials for a session cookie |

## Tests

`npm test` — unit tests for the pure functions, then the HTTP contract
against a running dev server. Needs `TEST_API_KEY`, `TEST_EMAIL` and
`TEST_PASSWORD` in `.env.local`.

## Deliberately not built

Realtime (polling on focus instead), comments, due dates, sprints,
notifications, attachments, configurable columns, roles. See
`docs/superpowers/specs/2026-09-10-tasktracker-design.md`.
````

- [ ] **Step 6: Confirm no Appwrite credentials reach the browser**

The single invariant this architecture exists to protect. Verify it rather than assuming it:

```bash
npm run build
grep -ril "appwrite" .next/static/ || echo "CLEAN: no Appwrite reference in client bundles"
grep -rl "NEXT_PUBLIC_APPWRITE" . --exclude-dir=node_modules --exclude-dir=.next || echo "CLEAN: no NEXT_PUBLIC_APPWRITE variable"
```

Expected: both print `CLEAN`. If the first finds a match, something imported `node-appwrite` into a client component — find it and move that call to the server. Do not proceed past this step with a failing result.

Then, in the running app's browser console:

```js
document.cookie   // must not contain tt_session
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: cross-door equivalence test, login route, and README"
```

---

## Verification summary

When every task is done, all of these must hold:

- [ ] `npm test` passes with zero skipped checks
- [ ] `npm run setup` is safe to run twice
- [ ] `document.cookie` does not expose `tt_session`
- [ ] `grep -ril appwrite .next/static/` finds nothing
- [ ] No client component or `middleware.ts` imports `@/lib/db` or `@/lib/auth`
- [ ] A card dragged between columns stays put after a reload
- [ ] `<script>` typed into a markdown field renders as text
- [ ] `PATCH`ing one markdown field leaves the other four untouched
- [ ] A note on a `done` task appears in `/api/context` under "Keep in mind"
- [ ] `/api/context` reads like a useful briefing, judged by eye
