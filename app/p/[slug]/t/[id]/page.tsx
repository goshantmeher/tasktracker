import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getTask, listLog, getProjectBySlug } from '@/lib/db'
import { addLogEntry } from '../../actions'
import { MarkdownField, ScalarForm } from './detail'
import { Markdown } from '@/components/markdown'
import { RefreshOnFocus } from '@/components/refresh-on-focus'

const FIELDS: [string, string][] = [
  ['description', 'Description'],
  ['requirement', 'Requirement'],
  ['prerequisites', 'Prerequisites'],
  ['result', 'Result'],
  ['notes', 'Notes'],
]

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

      <ScalarForm slug={slug} taskId={task.id} status={task.status} type={task.type}
        priority={task.priority} assignee={task.assignee} labels={task.labels} />

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
