'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/lib/auth-context'

const NAV_ITEMS = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/concepts', label: 'Concepts' },
  { href: '/graph', label: 'Map' },
  { href: '/session', label: 'Session' },
  { href: '/metrics', label: 'Understanding' },
] as const

/**
 * The ISSN-style masthead strip that sits above the nav — a live workspace
 * marker, the sovereignty tagline, and a volume number. Pure brand chrome.
 */
export function MastheadStrip() {
  return (
    <div className='mh-strip'>
      <span className='mh-live'>
        <span className='dot' /> Workspace · Lab Notebooks
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
          <Link href='/inbox' className='nav-brand'>
            Kibadist
          </Link>
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
