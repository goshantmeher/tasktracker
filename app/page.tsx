import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listProjects } from '@/lib/db'
import { addProject, toggleArchived } from './actions'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default async function Home() {
  const [user, projects] = await Promise.all([currentUser(), listProjects()])
  if (!user) redirect('/login')

  return (
    <AppShell user={user}>
      <div className="tt-scroll flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mb-6 text-sm text-tt-subtle">
            Every project is a board. Humans work it in the UI; agents read and write it
            over the API.
          </p>

          <form action={addProject} className="mb-6 flex max-w-md gap-2">
            <Input name="name" placeholder="New project name" required className="flex-1" />
            <Button type="submit">Create</Button>
          </form>

          {/* Project table: avatar, name, key, actions. */}
          <div className="overflow-hidden rounded-[3px] border border-tt-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tt-border bg-tt-sidebar text-left text-[12px] font-semibold text-tt-subtle">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Key</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-b border-tt-border last:border-0 hover:bg-tt-sidebar">
                    <td className="px-4 py-3">
                      <Link href={`/p/${p.slug}`} className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] text-xs font-bold text-white ${
                            p.archived ? 'bg-[#8993a4]' : 'bg-tt-blue'
                          }`}
                        >
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span
                          className={
                            p.archived
                              ? 'text-tt-subtle line-through'
                              : 'font-medium text-tt-blue hover:underline'
                          }
                        >
                          {p.name}
                        </span>
                        {p.archived && (
                          <span className="rounded-[3px] bg-[#dcdfe4] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e]">
                            Archived
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-tt-subtle">
                      {p.slug.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={toggleArchived}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="archived" value={String(!p.archived)} />
                        <button
                          type="submit"
                          className="rounded-[3px] px-2 py-1 text-[12px] text-tt-subtle hover:bg-tt-hover hover:text-tt-text"
                        >
                          {p.archived ? 'Unarchive' : 'Archive'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-tt-subtle">
                      No projects yet. Create one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
