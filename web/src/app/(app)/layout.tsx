'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { AppNav, MastheadStrip } from '@/components/app-shell/app-nav'
import { useAuth } from '@/lib/auth-context'

// Routes that take over the whole viewport (Figma-style canvas). They drop the
// masthead and the narrow reading column; the nav floats and children fill a
// fixed .workspace. Keep this list small — most screens are document-shaped.
const IMMERSIVE_ROUTES = ['/graph']
function isImmersive(pathname: string): boolean {
  return IMMERSIVE_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  )
}

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
  const pathname = usePathname()
  const immersive = isImmersive(pathname)

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

  // Immersive: no masthead, a floating slim nav, and a full-viewport workspace.
  if (immersive) {
    return (
      <div className='kbapp kbapp--immersive'>
        <AppNav />
        <main className='workspace'>{children}</main>
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
