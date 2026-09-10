'use client'

import Link from 'next/link'
import { useOptimistic, useTransition, useState, type FormEvent } from 'react'
import { nextOrder } from '@/lib/order.mjs'
// From '@/lib/shared', never '@/lib/db' — this is a client component, and
// lib/db imports node-appwrite. See Task 11 Step 6, which verifies this.
import { STATUSES, TASK_STRING_MAX, type Status, type Task } from '@/lib/shared'
import { moveTask, quickAddTask } from './actions'
import { TypeIcon, PriorityIcon, Avatar, issueKey } from '@/components/issue'

const LABELS: Record<Status, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  blocked: 'Blocked', done: 'Done',
}

/**
 * quickAddTask throws on an over-length title (same tasks.title column size
 * the REST door checks) instead of letting Appwrite reject it — thrown from a
 * bare `<form action={quickAddTask.bind(...)}>` bubbles straight to the
 * nearest error boundary, replacing the whole board and losing whatever the
 * user typed. Wrapping the call here (same recoverable pattern as detail.tsx's
 * MarkdownField/ScalarForm) keeps the typed title on screen and shows why it
 * wasn't added, instead of losing it.
 */
function QuickAdd({ slug, status }: { slug: string; status: Status }) {
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  // Plain onSubmit + preventDefault, not `<form action={fn}>` — see
  // detail.tsx's ScalarForm doc comment for why: React resets an
  // uncontrolled form's fields whenever an `action` function settles,
  // including a rejected save this component's own catch turned into
  // `error` state, which would silently wipe the title the user just typed
  // right as it's told them the add failed.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    start(async () => {
      try {
        await quickAddTask(slug, formData)
        setError(null)
        // The old `<form action={quickAddTask.bind(...)}>` cleared the title
        // for the next add as a side effect of React's post-action reset.
        // onSubmit doesn't do that, so it's done explicitly here — only on
        // success, so a failed add still leaves the typed title in place.
        form.reset()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'add failed')
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-sm text-tt-subtle hover:bg-[#dcdfe4] hover:text-tt-text"
      >
        <span className="text-base leading-none">+</span> Create
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1">
      <input type="hidden" name="status" value={status} />
      <input
        name="title"
        autoFocus
        placeholder="What needs to be done?"
        maxLength={TASK_STRING_MAX.title}
        disabled={pending}
        onBlur={e => { if (!e.currentTarget.value.trim()) { setOpen(false); setError(null) } }}
        className="tt-card w-full rounded-[3px] border-2 border-tt-blue bg-white px-2.5 py-2 text-sm outline-none placeholder:text-tt-subtle"
      />
      {error && <p className="px-1 pt-1 text-[11px] text-tt-red">{error}</p>}
    </form>
  )
}

export function Board({ slug, tasks }: { slug: string; tasks: Task[] }) {
  const [, startTransition] = useTransition()
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
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
    setDragging(null)
    setOver(null)
    if (!id) return
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
    <div className="tt-scroll flex flex-1 gap-2 overflow-x-auto px-6 pb-6 pt-2">
      {STATUSES.map(status => {
        const cards = column(status)
        return (
          <section
            key={status}
            onDragOver={e => { e.preventDefault(); setOver(status) }}
            onDragLeave={() => setOver(o => (o === status ? null : o))}
            onDrop={e => { e.preventDefault(); drop(status, null) }}
            // Lanes share the width rather than each taking a fixed 272px:
            // STATUSES is a closed set of five, so a fixed width guaranteed
            // the last lane sat off-screen at any normal viewport, reachable
            // only by the scrollbar pinned to the very bottom of the page.
            // min-w keeps them readable — below ~1130px of board the row
            // starts scrolling again, which is the case that warrants it.
            className={`flex max-h-full min-w-[200px] flex-1 flex-col rounded-[3px] p-2 transition-colors ${
              over === status ? 'bg-[#dcdfe4]' : 'bg-tt-column'
            }`}
          >
            <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-tt-subtle">
              {LABELS[status]}
              <span className="font-normal normal-case">{cards.length}</span>
            </h2>

            <div className="tt-scroll flex-1 space-y-2 overflow-y-auto">
              {cards.map(t => (
                <article
                  key={t.id}
                  draggable
                  onDragStart={() => setDragging(t.id)}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(status, t.id) }}
                  className={`tt-card cursor-grab rounded-[3px] bg-white p-2.5 active:cursor-grabbing ${
                    dragging === t.id ? 'tt-card-dragging opacity-90' : ''
                  }`}
                >
                  <Link
                    href={`/p/${slug}/t/${t.id}`}
                    className="mb-2 block text-sm leading-5 hover:text-tt-blue hover:underline"
                  >
                    {t.title}
                  </Link>

                  {t.labels.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {t.labels.map(l => (
                        <span
                          key={l}
                          className="rounded-[3px] bg-[#dcdfe4] px-1.5 py-0.5 text-[11px] font-medium text-[#42526e]"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card footer: type, key and priority on the left, the
                      assignee avatar pushed to the right. */}
                  <div className="flex items-center gap-1.5">
                    <TypeIcon type={t.type} />
                    <span className="text-[12px] font-semibold tracking-tight text-tt-subtle">
                      {issueKey(slug, t.id)}
                    </span>
                    <PriorityIcon priority={t.priority} />
                    {t.notes.trim() && (
                      <span
                        title="Has notes to keep in mind while working elsewhere"
                        className="text-[11px] text-tt-yellow"
                      >
                        ⚑
                      </span>
                    )}
                    <span className="ml-auto">
                      <Avatar name={t.assignee} size={24} />
                    </span>
                  </div>
                </article>
              ))}
            </div>

            <QuickAdd slug={slug} status={status} />
          </section>
        )
      })}
    </div>
  )
}
