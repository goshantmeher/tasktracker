import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listKeys } from '@/lib/db'
import { removeKey } from './actions'
import { MintForm } from './mint-form'
import { AppShell } from '@/components/app-shell'
import { Avatar } from '@/components/issue'

export default async function KeysPage() {
  const [user, keys] = await Promise.all([currentUser(), listKeys()])
  if (!user) redirect('/login')

  return (
    <AppShell user={user}>
      <div className="tt-scroll flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">API keys</h1>
          <p className="mb-6 max-w-2xl text-sm text-tt-subtle">
            A key grants full access to every project in this tracker — the same access as a
            signed-in user, with no per-project scoping. Hand out and revoke accordingly.
          </p>

          <div className="max-w-md">
            <MintForm />
          </div>

          <div className="mt-8 overflow-hidden rounded-[3px] border border-tt-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tt-border bg-tt-sidebar text-left text-[12px] font-semibold text-tt-subtle">
                  <th className="px-4 py-2.5">Label</th>
                  <th className="px-4 py-2.5">Created by</th>
                  <th className="px-4 py-2.5">Last used</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b border-tt-border last:border-0 hover:bg-tt-sidebar">
                    <td className="px-4 py-3 font-medium">{k.label}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 text-tt-subtle">
                        <Avatar name={k.createdBy} size={22} />
                        {k.createdBy}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* A date is data, not a status — only the "never" case
                          earns a lozenge, which is reserved for state. */}
                      {k.lastUsedAt ? (
                        <span className="text-tt-subtle">
                          {new Date(k.lastUsedAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className="rounded-[3px] bg-[#dcdfe4] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e]">
                          Never used
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={removeKey}>
                        <input type="hidden" name="id" value={k.id} />
                        <button
                          type="submit"
                          className="rounded-[3px] px-2 py-1 text-[12px] text-tt-red hover:bg-tt-red-bg"
                        >
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {keys.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-tt-subtle">
                      No keys yet. Create one above.
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
