'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Markdown } from '@/components/markdown'
import { saveField, saveScalars } from '../../actions'
// From '@/lib/shared', never '@/lib/db' — this is a client component. See
// board.tsx's matching import for the same reason.
import { STATUSES, TYPES, PRIORITIES, TASK_STRING_MAX, LABEL_COUNT_MAX, LABEL_MAX } from '@/lib/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// The stored enum values are snake_case; the UI shows prose. Display-only —
// the value submitted in FormData is still the raw enum.
const OPTION_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  blocked: 'Blocked', done: 'Done',
  bug: 'Bug', feature: 'Feature', chore: 'Chore',
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

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
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // The board's 10s RefreshOnFocus poll (or another tab, or the agent over
  // the REST API) can deliver a fresh `value` prop at any time. Sync from it
  // only while the user isn't actively editing — syncing unconditionally
  // would clobber whatever they're mid-typing; never syncing would leave
  // stale content on screen until a manual reload.
  //
  // Done during render (React's documented "adjusting state when a prop
  // changes" pattern), not a useEffect — an effect-based
  // `if (!editing) setText(value)` triggers eslint-plugin-react-hooks'
  // set-state-in-effect rule (a cascading-render warning) and pays for an
  // extra commit+effect pass on every poll. `syncedValue` remembers the
  // last `value` this field has absorbed, so the branch below is a no-op
  // once caught up.
  const [syncedValue, setSyncedValue] = useState(value)
  if (!editing && value !== syncedValue) {
    setSyncedValue(value)
    setText(value)
  }

  function commit() {
    if (text === value) { setEditing(false); return }
    const toSave = text
    start(async () => {
      try {
        await saveField(slug, taskId, field, toSave)
        setError(null)
        setEditing(false)
      } catch (e) {
        // Keep the editor open with the user's text intact — a failed save
        // must never look like a successful one.
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  return (
    <section className="mb-5">
      <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
        {label}
        {pending && <span className="text-[12px] font-normal text-tt-subtle">saving…</span>}
        {error && !pending && (
          <span className="text-[12px] font-normal text-tt-red">
            not saved: {error} — edit and click away to retry
          </span>
        )}
      </h3>
      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={e => { setText(e.target.value); setError(null) }}
          onBlur={commit}
          rows={Math.max(4, text.split('\n').length + 1)}
          className="w-full rounded-[3px] border-2 border-tt-blue bg-white p-2.5 font-mono text-sm outline-none"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[2.25rem] cursor-text rounded-[3px] p-2 hover:bg-tt-hover"
        >
          {text.trim()
            ? <Markdown>{text}</Markdown>
            : <span className="text-sm text-tt-subtle">{PLACEHOLDER[field]}</span>}
        </div>
      )}
    </section>
  )
}

// The scalar form uses shadcn's Select, not a native <select> — Base UI's
// Select.Root (not Radix here) has no intrinsic form-associated element, so
// it only reaches FormData because Select.Root renders a hidden
// `<input name=… value=…>` itself when given `name`. Verified by reading
// node_modules/@base-ui/react/select/root/SelectRoot.mjs, and by reading the
// live DOM's FormData in a running app.
//
// `key={defaultValue}` remounts the Select whenever the persisted value
// changes underneath it (this Save, another tab, or the agent writing
// status/type/priority over the REST API followed by a poll) — Base UI's
// Select is uncontrolled and, verified live, otherwise logs "changing the
// default value state of an uncontrolled Select after being initialized"
// and keeps showing the stale pick. A remount is safe here (unlike
// MarkdownField's textarea) because there's no in-progress typing to lose:
// this field only ever changes on a single discrete click.
function ScalarSelect({ name, options, defaultValue }: {
  name: string; options: readonly string[]; defaultValue: string
}) {
  return (
    <Select key={defaultValue} name={name} defaultValue={defaultValue}>
      <SelectTrigger size="sm">
        {/* Base UI's Select.Value takes a formatter function (verified in
            node_modules/@base-ui/react/select/value/SelectValue.d.ts); without
            it the trigger shows the raw stored enum, so the panel would read
            "in_progress" instead of "In Progress". */}
        <SelectValue>{(v: string) => OPTION_LABEL[v] ?? v}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o} value={o}>{OPTION_LABEL[o] ?? o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The task detail page's status/type/priority/assignee/labels row. A client
 * component (not a plain server-action-bound <form> like page.tsx used to
 * render) for the same reason MarkdownField above is one: saveScalars now
 * validates and can throw (over-length assignee, an over-long or malformed
 * labels edit — see actions.ts), and a plain form has no error boundary of
 * its own, so an uncaught throw here would replace the whole page the same
 * way an unguarded quickAddTask used to. Catching it here keeps the form's
 * picks/typed text on screen and shows why the save didn't happen.
 */
export function ScalarForm({
  slug, taskId, status, type, priority, assignee, labels,
}: {
  slug: string; taskId: string; status: string; type: string; priority: string
  assignee: string; labels: string[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Deliberately a plain onSubmit + preventDefault, NOT `<form action={fn}>`.
  // Verified live: with `action`, React calls requestFormReset() on every
  // resolved action — including one whose only job was to catch a thrown
  // validation error and report it via `error` state — so a rejected save
  // wiped the uncontrolled inputs back to their last-saved value regardless
  // of the catch below, discarding exactly the typed edit this component
  // exists to keep on screen. A regular onSubmit handler has no such
  // reset-on-settle behaviour; FormData is still read the same way.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    start(async () => {
      try {
        await saveScalars(slug, taskId, formData)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  return (
    <aside className="w-full shrink-0 lg:w-[300px]">
      <form
        onSubmit={submit}
        className="rounded-[3px] border border-tt-border bg-white"
      >
        <div className="border-b border-tt-border px-3 py-2 text-sm font-semibold">Details</div>

        <div className="space-y-3 p-3">
          <Row label="Status">
            <ScalarSelect name="status" options={STATUSES} defaultValue={status} />
          </Row>
          <Row label="Type">
            <ScalarSelect name="type" options={TYPES} defaultValue={type} />
          </Row>
          <Row label="Priority">
            <ScalarSelect name="priority" options={PRIORITIES} defaultValue={priority} />
          </Row>
          <Row label="Assignee">
            {/* `key` for the same reason ScalarSelect carries one: shadcn's
                Input is a Base UI FieldControl, uncontrolled here, and after
                a Save the server sends a fresh defaultValue down — which it
                logs as "changing the default value state of an uncontrolled
                FieldControl" while continuing to show the old text. Safe to
                remount: these only change on Save or an outside write. */}
            <Input key={assignee} name="assignee" defaultValue={assignee} placeholder="Unassigned"
              maxLength={TASK_STRING_MAX.assignee} className="h-8 text-sm" />
          </Row>
          <Row label="Labels">
            <Input key={labels.join(', ')} name="labels" defaultValue={labels.join(', ')} placeholder="None"
              className="h-8 text-sm" />
          </Row>
          <p className="text-[11px] leading-4 text-tt-subtle">
            Up to {LABEL_COUNT_MAX} labels, comma-separated. A label can’t itself
            contain a comma (each up to {LABEL_MAX} characters).
          </p>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {error && <p className="text-xs text-tt-red">not saved: {error}</p>}
        </div>
      </form>
    </aside>
  )
}

/** One `Label / control` row of the Details panel. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="text-[12px] font-medium text-tt-subtle">{label}</span>
      {children}
    </div>
  )
}
