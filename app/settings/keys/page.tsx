import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { listKeys } from '@/lib/db'
import { removeKey } from './actions'
import { MintForm } from './mint-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function KeysPage() {
  if (!(await currentUser())) redirect('/login')
  const keys = await listKeys()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm text-muted-foreground underline">← Projects</Link>
      <h1 className="mb-2 mt-3 text-xl font-semibold">API keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        A key grants full access to every project in this tracker — the same access
        as a signed-in user, with no per-project scoping. Hand out and revoke accordingly.
      </p>

      <MintForm />

      <Card className="mt-8">
        <CardContent className="divide-y">
          {keys.map(k => (
            <div key={k.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div>
                <div className="text-sm font-medium">{k.label}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>created by {k.createdBy}</span>
                  <Badge variant={k.lastUsedAt ? 'secondary' : 'outline'}>
                    {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}
                  </Badge>
                </div>
              </div>
              <form action={removeKey}>
                <input type="hidden" name="id" value={k.id} />
                <Button type="submit" variant="link" size="sm" className="text-xs text-destructive">
                  Revoke
                </Button>
              </form>
            </div>
          ))}
          {keys.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">No keys yet.</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
