'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { AppNav, MastheadStrip } from '@/components/app-shell/app-nav'
import { useAuth } from '@/lib/auth-context'

/**
 * Shared shell for authenticated screens. Gates access in one place: while the
 * session resolves it shows a loader, and unauthenticated visitors are sent to
 * /login. Children only render once a user is present, so no protected content
 * flashes before the redirect.
 *
 * This is a UI gate, not a security boundary — it only hides screens. The API
 * enforces real access control per request via the JWT (global JwtAuthGuard).
 *
 * The whole shell is wrapped in `.kbapp` so the editorial-manuscript component
 * layer (masthead, § nav, panels, chips, ruled rows) applies.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading || !user) {
    return (
      <div className='kbapp'>
        <main className='page'>
          <p className='notice'>Loading…</p>
        </main>
      </div>
    )
  }

  return (
    <div className='kbapp'>
      <MastheadStrip />
      <AppNav />
      <main className='page'>{children}</main>
    </div>
  )
}
