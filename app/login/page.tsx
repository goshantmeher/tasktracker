'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { login } from './actions'

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)
  return (
    // Centred white card on a tinted page.
    <main className="flex min-h-screen items-start justify-center bg-tt-sidebar px-6 py-20">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-tt-blue text-sm font-bold text-white">
            T
          </span>
          <span className="text-lg font-semibold tracking-tight text-tt-text">Task Tracker</span>
        </div>

        <div className="rounded-[3px] bg-white p-8 shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]">
          <h1 className="mb-6 text-center text-sm font-semibold text-tt-subtle">
            Log in to your account
          </h1>
          <form action={action} className="space-y-3">
            <Input name="email" type="email" placeholder="Email" required autoComplete="email" />
            <Input
              name="password"
              type="password"
              placeholder="Password"
              required
              autoComplete="current-password"
            />
            {error && <p className="text-sm text-tt-red">{error}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Signing in…' : 'Log in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-tt-subtle">
          Accounts are created in the Appwrite console. There is no sign-up page.
        </p>
      </div>
    </main>
  )
}
