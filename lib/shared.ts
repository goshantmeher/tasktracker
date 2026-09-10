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

/**
 * Whitelists a raw string against an allowed set of values — the check
 * behind every `pick(name, allowed)` helper that reads a scalar enum field
 * (status/type/priority/...) off a FormData at a trust boundary, e.g.
 * app/p/[slug]/actions.ts. Kept here rather than inline in those 'use
 * server' action files because Next.js strips non-async exports from a
 * 'use server' module (verified: the export silently disappears from the
 * compiled bundle), so this is the only way to unit-test it directly.
 */
export function isAllowed<T extends readonly string[]>(v: string, allowed: T): v is T[number] {
  return (allowed as readonly string[]).includes(v)
}
