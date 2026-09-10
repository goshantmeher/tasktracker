'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { login } from './actions'

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)
  return (
    <main className="mx-auto mt-32 w-full max-w-sm px-6">
      <h1 className="mb-6 text-xl font-semibold">Task Tracker</h1>
      <form action={action} className="space-y-3">
        <Input name="email" type="email" placeholder="Email" required />
        <Input name="password" type="password" placeholder="Password" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
