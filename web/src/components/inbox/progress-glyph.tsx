import type { InboxLearningStages } from '@/lib/api'

/**
 * Per-source learning glyph (DET-316) — three dots that fill as a captured source
 * moves through the loop: read → recalled → kept. Derived from persisted
 * article_learning_events (batched server-side), so triage reflects how far a
 * source has been understood, not just whether its article is ready. Null
 * progress (no companion article yet) renders three hollow dots.
 */
export function InboxProgressGlyph({
  learning,
}: {
  learning: InboxLearningStages | null
}) {
  const stages = [
    { key: 'read', on: Boolean(learning?.read), label: 'read' },
    { key: 'recalled', on: Boolean(learning?.recalled), label: 'recalled' },
    { key: 'kept', on: Boolean(learning?.kept), label: 'kept' },
  ]
  const done = stages.filter((s) => s.on).map((s) => s.label)
  const title =
    done.length > 0 ? `Progress: ${done.join(' · ')}` : 'Not read yet'

  return (
    <span className='inbox-glyph' title={title} aria-label={title}>
      {stages.map((s) => (
        <span
          key={s.key}
          className={`inbox-glyph-dot${s.on ? ' is-on' : ''}`}
          aria-hidden='true'
        />
      ))}
    </span>
  )
}
