import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getTask, getProjectBySlug, STATUSES, TYPES, PRIORITIES } from '@/lib/db'
import { saveScalars } from '../../actions'
import { MarkdownField } from './detail'
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

  return (
    <main className="mx-auto max-w-3xl p-6">
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
    </main>
  )
}
