'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * The thin line that crawls across the bottom of the top bar while a page
 * loads. Every navigation in this app is a <Link>, i.e. an <a> click, so one
 * capture-phase listener on the document catches all of them — which beats
 * threading `useLinkStatus` through every Link, since that hook only works
 * inside the Link it belongs to and there are cards, breadcrumbs and sidebar
 * entries scattered across four files.
 *
 * It is a lie in the honest sense: nothing here knows how far along the
 * server is, so the bar eases toward 92% and only reaches the end when the
 * pathname actually changes. Same trick every browser used before streaming.
 */
export function NavProgress() {
  const pathname = usePathname()
  // The pathname we were on when a navigation started. Still equal to the
  // live pathname means the new page has not rendered yet; different means it
  // just did, which is the finish line. Derived rather than stored so the
  // pathname change alone flips the state — no effect writing state back.
  const [from, setFrom] = useState<string | null>(null)
  const phase = from === null ? 'idle' : from === pathname ? 'loading' : 'done'

  // Start on any click that will actually navigate somewhere else.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return

      const href = a.getAttribute('href')
      if (!href || href.startsWith('#')) return
      const url = new URL(a.href, location.href)
      // Cross-origin leaves the app; the same URL re-renders nothing. Either
      // way no pathname change is coming, so the bar would never finish.
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname) return

      setFrom(location.pathname)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Let the finishing animation play, then take the bar away.
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setFrom(null), 300)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'idle') return null

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className={`pointer-events-none absolute inset-x-0 -bottom-px h-0.5 origin-left bg-tt-blue ${
        phase === 'done'
          ? 'scale-x-100 opacity-0 transition-[transform,opacity] duration-300'
          : 'tt-nav-progress'
      }`}
    />
  )
}
