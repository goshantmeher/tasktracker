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
