import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getTask, listLog, getProjectBySlug, STATUSES, TYPES, PRIORITIES } from '@/lib/db'
import { saveScalars, addLogEntry } from '../../actions'
import { MarkdownField } from './detail'
import { Markdown } from '@/components/markdown'
import { RefreshOnFocus } from '@/components/refresh-on-focus'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const FIELDS: [string, string][] = [
  ['description', 'Description'],
  ['requirement', 'Requirement'],
  ['prerequisites', 'Prerequisites'],
  ['result', 'Result'],
  ['notes', 'Notes'],
]

// The scalar form uses shadcn's Select, not a native <select> — Base UI's
// Select.Root (not Radix here) has no intrinsic form-associated element, so
// it only reaches FormData because Select.Root renders a hidden
// `<input name=… value=…>` itself when given `name`. Verified by reading
// node_modules/@base-ui/react/select/root/SelectRoot.mjs, and by reading the
// live DOM's FormData in a running app (see task-6-report.md).
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

export default async function TaskPage(
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params
  if (!(await currentUser())) redirect('/login')
  const project = await getProjectBySlug(slug)
  if (!project) notFound()
  const task = await getTask(id)
  if (!task || task.projectId !== project.id) notFound()
  const log = await listLog(task.id)

  return (
    <main className="mx-auto max-w-3xl p-6">
      <RefreshOnFocus />
      <Link href={`/p/${slug}`} className="text-sm text-muted-foreground underline">← Board</Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold">{task.title}</h1>

      <form action={saveScalars.bind(null, slug, task.id)}
        className="mb-8 flex flex-wrap items-center gap-2 rounded border bg-muted/40 p-3">
        <ScalarSelect name="status" options={STATUSES} defaultValue={task.status} />
        <ScalarSelect name="type" options={TYPES} defaultValue={task.type} />
        <ScalarSelect name="priority" options={PRIORITIES} defaultValue={task.priority} />
        <Input name="assignee" defaultValue={task.assignee} placeholder="Assignee" className="w-40" />
        <Input name="labels" defaultValue={task.labels.join(', ')} placeholder="labels, comma, separated"
          className="flex-1" />
        <Button type="submit">Save</Button>
      </form>

      {FIELDS.map(([field, label]) => (
        <MarkdownField key={field} slug={slug} taskId={task.id}
          field={field} label={label} value={task[field as keyof typeof task] as string} />
      ))}

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
    </main>
  )
}
