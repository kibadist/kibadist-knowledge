'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useWorkspace } from '@/lib/workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'

// Nav as the core loop (DET-302): capture → read → earn → review, ≤5 items in
// loop order. "Read" is the merged source/article surface (capture + triage on
// /inbox since DET-300; source/article views open from its rows). "Progress" is
// the renamed Understanding metrics. Tracks live on Today as the organizing
// widget; Domains fold into the Map's DOMAIN scope control; Session is reached
// from Today's "Start session" — all three routes stay reachable, just off the
// top-level bar.
const NAV_ITEMS = [
  { href: '/today', label: 'Today' },
  { href: '/inbox', label: 'Read' },
  { href: '/concepts', label: 'Concepts' },
  { href: '/graph', label: 'Map' },
  { href: '/metrics', label: 'Progress' },
] as const

/**
 * The ISSN-style masthead strip that sits above the nav — a live marker for the
 * active workspace (DET-233), the sovereignty tagline, and a volume number.
 */
export function MastheadStrip() {
  const { activeWorkspace } = useWorkspace()
  return (
    <div className='mh-strip'>
      <span className='mh-live'>
        <span className='dot' /> Workspace · {activeWorkspace?.name ?? '—'}
      </span>
      <span className='mh-mid'>Local-first · Logseq-based · Sovereign</span>
      <span>Vol I · № 014</span>
    </div>
  )
}

/** Primary navigation for the authenticated app shell — §-prefixed mono items. */
export function AppNav() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  // Inbox "debt" badge (DET-241), now on §READ (DET-302): a gentle count of
  // unprocessed captures. Shares the ['inbox'] cache with the Read page, so it
  // updates the moment an item is processed or discarded.
  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })
  const inboxCount = inboxQuery.data?.length ?? 0
  // Due-recall badge on §TODAY (DET-302): how many concepts are due to recall,
  // so the daily habit stays visible. Shares the ['due-retrievals'] cache with
  // the Today panel.
  const dueQuery = useQuery({
    queryKey: ['due-retrievals'],
    queryFn: api.getDueRetrievals,
  })
  const dueCount = dueQuery.data?.length ?? 0

  return (
    <header className='app-nav-wrap'>
      <nav className='app-nav'>
        <div className='app-nav-left'>
          <Link href='/today' className='nav-brand'>
            Kibadist
          </Link>
          <WorkspaceSwitcher />
          <div className='nav-items'>
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`nav-item${active ? ' is-active' : ''}`}
                >
                  {item.label}
                  {item.href === '/inbox' && inboxCount > 0 && (
                    <span className='nav-badge'>{inboxCount}</span>
                  )}
                  {item.href === '/today' && dueCount > 0 && (
                    <span className='nav-badge nav-badge-due'>{dueCount}</span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
        <div className='app-nav-right'>
          {user && <span className='nav-user'>{user.email}</span>}
          <button type='button' onClick={logout} className='btn-ghost-sm'>
            Sign out
          </button>
        </div>
      </nav>
    </header>
  )
}
