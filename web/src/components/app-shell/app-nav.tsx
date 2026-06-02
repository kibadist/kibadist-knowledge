'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/lib/auth-context'
import { useWorkspace } from '@/lib/workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'

const NAV_ITEMS = [
  { href: '/tracks', label: 'Tracks' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/concepts', label: 'Concepts' },
  { href: '/graph', label: 'Map' },
  { href: '/session', label: 'Session' },
  { href: '/metrics', label: 'Understanding' },
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

  return (
    <header className='app-nav-wrap'>
      <nav className='app-nav'>
        <div className='app-nav-left'>
          <Link href='/tracks' className='nav-brand'>
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
