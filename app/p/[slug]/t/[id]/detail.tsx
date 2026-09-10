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
    <section className="mb-6">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {pending && <span className="ml-2 font-normal normal-case">saving…</span>}
        {error && !pending && (
          <span className="ml-2 font-normal normal-case text-destructive">
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
          className="w-full rounded border p-2 font-mono text-sm"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[2rem] cursor-text rounded p-2 hover:bg-muted/50"
        >
          {text.trim()
            ? <Markdown>{text}</Markdown>
            : <span className="text-sm text-muted-foreground">{PLACEHOLDER[field]}</span>}
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
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
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
    <div className="mb-8">
      <form onSubmit={submit}
        className="flex flex-wrap items-center gap-2 rounded border bg-muted/40 p-3">
        <ScalarSelect name="status" options={STATUSES} defaultValue={status} />
        <ScalarSelect name="type" options={TYPES} defaultValue={type} />
        <ScalarSelect name="priority" options={PRIORITIES} defaultValue={priority} />
        <Input name="assignee" defaultValue={assignee} placeholder="Assignee"
          maxLength={TASK_STRING_MAX.assignee} className="w-40" />
        <Input name="labels" defaultValue={labels.join(', ')}
          placeholder={`up to ${LABEL_COUNT_MAX} labels, comma-separated — a label can't itself contain a comma (each up to ${LABEL_MAX} chars)`}
          className="flex-1" />
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      </form>
      {error && <p className="mt-1.5 text-xs text-destructive">not saved: {error}</p>}
    </div>
  )
}
