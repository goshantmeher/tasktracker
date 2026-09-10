import Link from 'next/link'
import { logout } from '@/app/login/actions'
import { Avatar } from './issue'
import { NavProgress } from './nav-progress'

/**
 * App chrome: a slim top bar across the full width, and a left project
 * sidebar under it. A server component — it reads nothing itself, it just
 * takes what the page already fetched, so it adds no queries.
 *
 * `project` is null on pages that sit above a project (the project list, API
 * keys), which render the nav rail without a project context.
 */
export function AppShell({
  user, project, nav, breadcrumb, children,
}: {
  user: { name: string }
  project?: { name: string; slug: string } | null
  nav?: 'board' | 'keys' | null
  breadcrumb?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // h-screen, not min-h-screen: the board must be exactly one viewport tall
    // so the columns scroll internally (and each column's Create button stays
    // pinned to its foot) instead of the whole page growing past the fold.
    <div className="flex h-screen flex-col overflow-hidden bg-white text-tt-text">
      {/* Top navigation */}
      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-tt-border px-4">
        <NavProgress />
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-tt-blue text-xs font-bold text-white">
            T
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Task Tracker</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          <Link
            href="/"
            className="rounded-[3px] px-3 py-1.5 text-sm font-medium text-tt-subtle hover:bg-tt-hover hover:text-tt-text"
          >
            Projects
          </Link>
          <Link
            href="/settings/keys"
            className="rounded-[3px] px-3 py-1.5 text-sm font-medium text-tt-subtle hover:bg-tt-hover hover:text-tt-text"
          >
            API keys
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <form action={logout}>
            <button
              type="submit"
              className="rounded-[3px] px-2 py-1 text-sm text-tt-subtle hover:bg-tt-hover hover:text-tt-text"
            >
              Sign out
            </button>
          </form>
          <Avatar name={user.name} size={28} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Project sidebar */}
        {project && (
          <aside className="hidden w-60 shrink-0 border-r border-tt-border bg-tt-sidebar px-3 py-4 lg:block">
            <div className="mb-4 flex items-center gap-2.5 px-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] bg-tt-blue text-sm font-bold text-white"
                aria-hidden
              >
                {project.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{project.name}</div>
                <div className="text-[11px] text-tt-subtle">Software project</div>
              </div>
            </div>

            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-tt-subtle">
              Planning
            </div>
            <SidebarLink href={`/p/${project.slug}`} active={nav === 'board'}>
              Board
            </SidebarLink>

            <div className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-tt-subtle">
              Settings
            </div>
            <SidebarLink href="/settings/keys" active={nav === 'keys'}>
              API keys
            </SidebarLink>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {breadcrumb && (
            <div className="shrink-0 px-6 pt-4 text-xs text-tt-subtle">{breadcrumb}</div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}

function SidebarLink({
  href, active, children,
}: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`block rounded-[3px] px-2 py-1.5 text-sm ${
        active
          ? 'bg-tt-blue-subtle font-semibold text-tt-blue-hover'
          : 'text-tt-text hover:bg-tt-hover'
      }`}
    >
      {children}
    </Link>
  )
}

/** `Projects / Scratch` — the breadcrumb above the board title. */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-1.5">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-tt-border">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-tt-blue hover:underline">
              {it.label}
            </Link>
          ) : (
            <span>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
