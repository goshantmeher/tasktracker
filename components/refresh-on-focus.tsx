'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ponytail: polling, not realtime. Appwrite's realtime needs credentials in
 * the browser, which the SSR design forbids. Upgrade path if this feels
 * stale: an SSE route where the server holds the Appwrite subscription.
 */
export function RefreshOnFocus({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => { if (!document.hidden) router.refresh() }
    const id = setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, intervalMs])
  return null
}
