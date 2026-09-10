'use client'

import Link from 'next/link'
import { useOptimistic, useTransition, useState } from 'react'
import { nextOrder } from '@/lib/order.mjs'
// From '@/lib/shared', never '@/lib/db' — this is a client component, and
// lib/db imports node-appwrite. See Task 11 Step 6, which verifies this.
import { STATUSES, type Status, type Task } from '@/lib/shared'
import { moveTask, quickAddTask } from './actions'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

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
    // Dropping a card onto itself is a trivially easy accidental gesture.
    // Treat it as a true no-op rather than computing a new position for it —
    // see lib/order.mjs's nextOrder doc comment for the crash this used to
    // cause and the defensive fallback that still guards it below.
    if (beforeId === id) return
    const order = nextOrder(column(status), beforeId, id)
    startTransition(async () => {
      applyMove({ id, status, order })
      await moveTask(slug, id, status, order)
    })
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map(status => (
        <Card
          key={status}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); drop(status, null) }}
          className="w-72 shrink-0 bg-muted p-3"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {LABELS[status]} <span className="text-muted-foreground/70">{column(status).length}</span>
          </h2>

          <div className="flex-1 space-y-2">
            {column(status).map(t => (
              <Card
                key={t.id}
                draggable
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(status, t.id) }}
                className={`gap-2 p-3 shadow-sm ${dragging === t.id ? 'opacity-40' : ''}`}
              >
                <Link href={`/p/${slug}/t/${t.id}`} className="block text-sm font-medium">
                  {t.title}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority]}`}
                    title={t.priority} />
                  <span>{t.type}</span>
                  {t.assignee && <span>· {t.assignee}</span>}
                  {t.notes.trim() && (
                    <span title="Has notes to keep in mind" className="text-amber-600">⚑</span>
                  )}
                  {t.labels.map(l => (
                    <Badge key={l} variant="secondary">{l}</Badge>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <form
            action={quickAddTask.bind(null, slug)}
            className="mt-2"
          >
            <input type="hidden" name="status" value={status} />
            <Input
              name="title"
              placeholder="+ Add"
              className="border-none px-2 py-1.5 text-sm shadow-none focus-visible:bg-card focus-visible:ring-1"
            />
          </form>
        </Card>
      ))}
    </div>
  )
}
