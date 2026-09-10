'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { mintKey } from './actions'

export function MintForm() {
  const [key, action, pending] = useActionState(mintKey, null)
  return (
    <>
      <form action={action} className="flex gap-2">
        <Input name="label" placeholder="Label, e.g. claude-laptop" required className="flex-1" />
        <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create'}</Button>
      </form>
      {key && (
        <Card className="mt-4 border-amber-300 bg-amber-50">
          <CardContent>
            <p className="mb-2 text-xs font-medium text-amber-900">
              Copy this now — it grants full access to every project and cannot be shown again.
            </p>
            <code className="block break-all rounded bg-background p-2 font-mono text-xs">{key}</code>
          </CardContent>
        </Card>
      )}
    </>
  )
}
