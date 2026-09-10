import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/shared'

export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  return NextResponse.redirect(new URL('/login', req.url))
}

// Everything except /login, /api/* (key-authenticated), and static assets.
export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
}
