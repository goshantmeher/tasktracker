import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getProjectBySlug, listTasks } from '@/lib/db'
import { RefreshOnFocus } from '@/components/refresh-on-focus'
import { AppShell, Breadcrumb } from '@/components/app-shell'
import { Avatar } from '@/components/issue'
import { Board } from './board'

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Independent of each other, so they go together; listTasks below is the
  // one that genuinely has to wait, since it needs the project's id.
  const [user, project] = await Promise.all([currentUser(), getProjectBySlug(slug)])
  if (!user) redirect('/login')
  if (!project) notFound()
  // No `limit` here — listTasks's own default (5000) is the real ceiling now.
  // A hardcoded 500 would silently truncate a large project's board again,
  // exactly what raising that default was meant to stop.
  const tasks = await listTasks({ projectId: project.id })

  // The people on the board, as a stacked avatar row. Assignees
  // come from the tasks already fetched, so this costs no extra query.
  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))]

  return (
    <AppShell
      user={user}
      project={project}
      nav="board"
      breadcrumb={
        <Breadcrumb items={[{ label: 'Projects', href: '/' }, { label: project.name }]} />
      }
    >
      <RefreshOnFocus />
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pb-1 pt-2">
        <h1 className="text-xl font-semibold tracking-tight">Board</h1>
        {assignees.length > 0 && (
          <div className="flex items-center -space-x-1.5">
            {assignees.slice(0, 6).map(a => (
              <span key={a} className="rounded-full ring-2 ring-white">
                <Avatar name={a} size={28} />
              </span>
            ))}
            {assignees.length > 6 && (
              <span className="ml-2 text-xs text-tt-subtle">+{assignees.length - 6}</span>
            )}
          </div>
        )}
        <span className="ml-auto text-xs text-tt-subtle">
          {tasks.length} {tasks.length === 1 ? 'issue' : 'issues'}
        </span>
      </div>
      <Board slug={slug} tasks={tasks} />
    </AppShell>
  )
}
