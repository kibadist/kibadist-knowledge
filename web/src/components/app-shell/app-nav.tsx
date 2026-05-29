'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/lib/auth-context'

const NAV_ITEMS = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/concepts', label: 'Concepts' },
  { href: '/session', label: 'Session' },
] as const

/** Top navigation for the authenticated app shell. */
export function AppNav() {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  return (
    <header className='border-b border-neutral-800'>
      <nav className='mx-auto flex max-w-3xl items-center justify-between gap-4 p-4'>
        <div className='flex items-center gap-1'>
          <Link href='/inbox' className='mr-3 font-semibold'>
            Kibadist
          </Link>
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  active
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
        <div className='flex items-center gap-3'>
          {user && (
            <span className='hidden text-sm text-neutral-400 sm:inline'>
              {user.email}
            </span>
          )}
          <button
            type='button'
            onClick={logout}
            className='rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900'
          >
            Sign out
          </button>
        </div>
      </nav>
    </header>
  )
}
