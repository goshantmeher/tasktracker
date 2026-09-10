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
