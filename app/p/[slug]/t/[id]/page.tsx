import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getTask, listLog, getProjectBySlug } from '@/lib/db'
import { addLogEntry } from '../../actions'
import { MarkdownField, ScalarForm } from './detail'
import { DeleteTask } from './delete-task'
import { Markdown } from '@/components/markdown'
import { RefreshOnFocus } from '@/components/refresh-on-focus'
import { AppShell, Breadcrumb } from '@/components/app-shell'
import { TypeIcon, Avatar, issueKey } from '@/components/issue'

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
  // One round trip, not four. Every one of these depends only on `slug` and
  // `id`, both of which are already in hand — the old sequential awaits were
  // a waterfall by accident, not because anything needed the previous answer.
  // The checks below are unchanged and still run before anything renders;
  // only the fetching moved. Cost of getting this wrong is small and known:
  // a request with a stale cookie now does three reads before its redirect,
  // where it used to do none. There is no ownership model to leak through.
  const [user, project, task, log] = await Promise.all([
    currentUser(), getProjectBySlug(slug), getTask(id), listLog(id),
  ])
  if (!user) redirect('/login')
  if (!project) notFound()
  if (!task || task.projectId !== project.id) notFound()
  const key = issueKey(slug, task.id)

  return (
    <AppShell
      user={user}
      project={project}
      nav="board"
      breadcrumb={
        <Breadcrumb
          items={[
            { label: 'Projects', href: '/' },
            { label: project.name, href: `/p/${slug}` },
            { label: key },
          ]}
        />
      }
    >
      <RefreshOnFocus />

      <div className="tt-scroll flex-1 overflow-y-auto px-6 pb-10 pt-2">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-tt-subtle">
          <TypeIcon type={task.type} size={14} />
          {key}
        </div>
        <div className="mb-5 flex items-start gap-4">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{task.title}</h1>
          <DeleteTask slug={slug} taskId={task.id} title={task.title} />
        </div>

        {/* Issue view: content on the left, a Details panel on the
            right. Stacks to one column below lg, where a side panel would
            squeeze the markdown too narrow to read. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            {FIELDS.map(([field, label]) => (
              <MarkdownField key={field} slug={slug} taskId={task.id}
                field={field} label={label} value={task[field as keyof typeof task] as string} />
            ))}

            <section className="mt-8 border-t border-tt-border pt-5">
              <h3 className="mb-4 text-sm font-semibold">Activity</h3>

              <form action={addLogEntry.bind(null, slug, task.id)} className="mb-6 flex gap-3">
                <Avatar name={user.name} size={32} />
                <div className="min-w-0 flex-1 space-y-2">
                  <textarea name="body" rows={3} placeholder="Add a comment…"
                    className="w-full rounded-[3px] border border-tt-border bg-white p-2.5 text-sm outline-none focus:border-tt-blue focus:ring-1 focus:ring-tt-blue" />
                  <button className="rounded-[3px] bg-tt-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-tt-blue-hover">
                    Save
                  </button>
                </div>
              </form>

              {/* Newest first — the most recent work is what you came to read. */}
              <ol className="space-y-5">
                {[...log].reverse().map(e => (
                  <li key={e.id} className="flex gap-3">
                    <Avatar name={e.author} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-semibold">{e.author}</span>
                        <span className="text-[12px] text-tt-subtle">
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <Markdown>{e.body}</Markdown>
                    </div>
                  </li>
                ))}
                {log.length === 0 && (
                  <li className="text-sm text-tt-subtle">No activity yet.</li>
                )}
              </ol>
            </section>
          </div>

          <ScalarForm slug={slug} taskId={task.id} status={task.status} type={task.type}
            priority={task.priority} assignee={task.assignee} labels={task.labels} />
        </div>
      </div>
    </AppShell>
  )
}
