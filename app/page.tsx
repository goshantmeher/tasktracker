import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listProjects } from '@/lib/db'
import { logout } from './login/actions'
import { addProject, toggleArchived } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const projects = await listProjects()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/settings/keys" className="underline">API keys</Link>
          <form action={logout}>
            <Button type="submit" variant="link">Sign out</Button>
          </form>
        </div>
      </header>

      <form action={addProject} className="mb-6 flex gap-2">
        <Input name="name" placeholder="New project name" required className="flex-1" />
        <Button type="submit">Add</Button>
      </form>

      <Card>
        <CardContent className="divide-y">
          {projects.map(p => (
            <div key={p.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <Link href={`/p/${p.slug}`}
                className={p.archived ? 'text-muted-foreground line-through' : 'font-medium'}>
                {p.name}
              </Link>
              <form action={toggleArchived}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="archived" value={String(!p.archived)} />
                <Button type="submit" variant="link" size="sm" className="text-xs text-muted-foreground">
                  {p.archived ? 'Unarchive' : 'Archive'}
                </Button>
              </form>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">No projects yet.</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
