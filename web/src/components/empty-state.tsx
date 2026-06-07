import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared empty state (DET-308). Every empty surface reads the same way: a plain
 * observation, an optional clarifying hint, and — where the loop has a previous
 * step — a single CTA that hands the user that step as a link. This replaces the
 * bare `div.empty` pattern that was scattered across the surfaces.
 *
 * The rule the copy follows: point FORWARD in the loop (capture → read → earn →
 * review) by linking one step BACK from wherever the user is stranded, and never
 * name a surface by jargon the user hasn't reached yet. A surface that sits at
 * the start of the loop (capture) — or whose action already sits directly above
 * the empty state (the inline "new" forms) — passes no `cta`; `children` is there
 * for the rare case that needs an extra control alongside the CTA.
 */
export function EmptyState({
  message,
  hint,
  cta,
  children,
}: {
  message: ReactNode
  hint?: ReactNode
  cta?: { href: string; label: string }
  children?: ReactNode
}) {
  return (
    <div className='empty'>
      {message}
      {hint && <span>{hint}</span>}
      {cta && (
        <Link href={cta.href} className='btn-primary empty-cta'>
          {cta.label} <span className='ar'>→</span>
        </Link>
      )}
      {children}
    </div>
  )
}
