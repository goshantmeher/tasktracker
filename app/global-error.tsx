'use client'

import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html>
      <body className="bg-background text-foreground">
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md text-center">
            {error.message || 'An unexpected error occurred'}
          </p>
          <Button onClick={retry}>Try again</Button>
        </div>
      </body>
    </html>
  )
}
