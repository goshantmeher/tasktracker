'use client'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background text-foreground px-4">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-center">
        {error.message || 'An unexpected error occurred'}
      </p>
      <Button onClick={retry}>Try again</Button>
    </div>
  )
}
