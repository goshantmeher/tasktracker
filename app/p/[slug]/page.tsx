import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { getProjectBySlug, listTasks } from '@/lib/db'
import { RefreshOnFocus } from '@/components/refresh-on-focus'
import { Board } from './board'

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await currentUser())) redirect('/login')

  const project = await getProjectBySlug(slug)
  if (!project) notFound()
  // No `limit` here — listTasks's own default (5000) is the real ceiling now.
  // A hardcoded 500 would silently truncate a large project's board again,
  // exactly what raising that default was meant to stop.
  const tasks = await listTasks({ projectId: project.id })

  return (
    <main className="p-6">
      <RefreshOnFocus />
      <header className="mb-6 flex items-baseline gap-3">
        <Link href="/" className="text-sm text-muted-foreground underline">Projects</Link>
        <h1 className="text-xl font-semibold">{project.name}</h1>
      </header>
      <Board slug={slug} tasks={tasks} />
    </main>
  )
}
