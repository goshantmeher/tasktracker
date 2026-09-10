'use client'

import { useTransition } from 'react'
import { removeTask } from '../../actions'

/**
 * Destructive, so it goes behind a confirm. A client
 * component purely for `window.confirm` — the native dialog is the whole
 * guard, and a modal component would be more code for the same answer.
 */
export function DeleteTask({ slug, taskId, title }: {
  slug: string; taskId: string; title: string
}) {
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete “${title}”?\n\nThis removes the task and its activity for good.`)) return
        start(() => { removeTask(slug, taskId) })
      }}
      className="rounded-[3px] px-2 py-1 text-[12px] text-tt-red hover:bg-tt-red-bg disabled:opacity-60"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  )
}
