'use client'

import {
  isEmptyComparison,
  type RewriteComparison,
  SOURCE_CONFIDENCE_LABEL,
} from '@/lib/compare-repair'

/**
 * Compare & Repair feedback panel (DET-286).
 *
 * After a learner's reconstruction is compared against the article block, this
 * shows the structured, source-faithful feedback. It is corrective, not a grade
 * (a DET-286 non-goal): buckets are framed as observations and empty ones are
 * omitted. The panel's job is to make gaps *visible* and distinguish the kinds of
 * gap from one another (the AC):
 *  - "You preserved"        — ideas kept faithfully (encouraging, shown first).
 *  - "You missed"           — block ideas dropped (missing ≠ wrong).
 *  - "Meaning changed"      — block ideas flipped (a misconception to repair).
 *  - "Unsupported additions"— invented claims (≠ harmless rewording).
 * The repair prompt below asks for exactly one improved attempt — never a score.
 */
export interface CompareFeedbackPanelProps {
  comparison: RewriteComparison
}

interface BucketMeta {
  key:
    | 'preserved_claims'
    | 'missing_claims'
    | 'distorted_claims'
    | 'unsupported_claims'
  label: string
  blurb: string
  tone: 'match' | 'gap' | 'changed' | 'extra'
}

/** Order: kept first (encouraging) → missed → meaning-changed → invented. */
const BUCKETS: BucketMeta[] = [
  {
    key: 'preserved_claims',
    label: 'You preserved',
    blurb: 'Ideas you reconstructed faithfully from the block.',
    tone: 'match',
  },
  {
    key: 'missing_claims',
    label: 'You missed',
    blurb: 'Ideas the block makes that your version left out.',
    tone: 'gap',
  },
  {
    key: 'distorted_claims',
    label: 'Meaning changed',
    blurb: 'Ideas whose meaning shifted — worth restating the block’s way.',
    tone: 'changed',
  },
  {
    key: 'unsupported_claims',
    label: 'Unsupported additions',
    blurb: "Claims you added that the block doesn't support.",
    tone: 'extra',
  },
]

export function CompareFeedbackPanel({
  comparison,
}: CompareFeedbackPanelProps) {
  if (isEmptyComparison(comparison)) {
    return (
      <div className='kb-cmp-feedback is-empty'>
        <p className='kb-cmp-feedback-empty'>
          Nothing to compare yet — write a reconstruction and it will be checked
          against the block here.
        </p>
      </div>
    )
  }

  const visible = BUCKETS.filter((b) => comparison[b.key].length > 0)
  const confidenceLabel = SOURCE_CONFIDENCE_LABEL[comparison.source_confidence]

  return (
    <div className='kb-cmp-feedback' aria-label='Comparison feedback'>
      <div className='kb-cmp-feedback-head'>
        <p className='kb-cmp-feedback-eyebrow'>Your version vs. the block</p>
        <span
          className={`kb-cmp-confidence kb-cmp-confidence--${comparison.source_confidence}`}
          title='Source provenance of your answer (DET-278 §5)'
        >
          {confidenceLabel}
        </span>
      </div>

      <div className='kb-cmp-grid'>
        {visible.map((bucket) => (
          <section
            key={bucket.key}
            className={`kb-cmp-bucket kb-cmp-bucket--${bucket.tone}`}
          >
            <header className='kb-cmp-bucket-head'>
              <span className='kb-cmp-bucket-label'>{bucket.label}</span>
              <span className='kb-cmp-bucket-count' aria-hidden='true'>
                {comparison[bucket.key].length}
              </span>
            </header>
            <p className='kb-cmp-bucket-blurb'>{bucket.blurb}</p>
            <ul className='kb-cmp-bucket-list'>
              {comparison[bucket.key].map((item) => (
                <li key={item} className='kb-cmp-bucket-item'>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {comparison.detected_misconceptions.length > 0 && (
        <div className='kb-cmp-misconceptions'>
          <p className='kb-cmp-misconceptions-eyebrow'>Worth repairing</p>
          <ul className='kb-cmp-misconceptions-list'>
            {comparison.detected_misconceptions.map((m) => (
              <li key={m.belief} className='kb-cmp-misconception'>
                <span className='kb-cmp-misconception-belief'>
                  “{m.belief}”
                </span>
                <span className='kb-cmp-misconception-arrow' aria-hidden='true'>
                  {' → '}
                </span>
                <span className='kb-cmp-misconception-article'>
                  {m.article}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className='kb-cmp-repair'>
        <p className='kb-cmp-repair-eyebrow'>Try again</p>
        <p className='kb-cmp-repair-prompt'>{comparison.repair_prompt}</p>
      </div>

      <p className='kb-cmp-feedback-foot'>
        Feedback on meaning, not grammar — nothing here is saved as a note or
        concept.
      </p>
    </div>
  )
}
