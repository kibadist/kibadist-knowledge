'use client'

import {
  isEmptyComparison,
  type PredictionComparison,
} from '@/lib/predict-comparison'

/**
 * Predict-before-reveal comparison panel (DET-282).
 *
 * After the learner submits a prediction and the section is revealed, this shows
 * the lightweight comparison between what they expected and what the article
 * actually says. It is corrective feedback, not a grade (a DET-282 non-goal): the
 * four buckets are framed as observations and empty ones are simply omitted.
 *
 * The clearest signal it carries is the AC distinction between *missing
 * information* (the article covers it, you didn't predict it) and *incorrect
 * assumptions* (you predicted it, the section doesn't address it) — they get
 * distinct framing and tone so the learner can tell a gap from a misconception.
 */
export interface PredictComparisonPanelProps {
  comparison: PredictionComparison
  /** The prediction the learner wrote, echoed back verbatim above the buckets. */
  prediction?: string
}

interface BucketMeta {
  key: keyof PredictionComparison
  label: string
  blurb: string
  tone: 'match' | 'gap' | 'check' | 'extra'
}

/** Order matters: matched first (encouraging), assumptions last (gentle). */
const BUCKETS: BucketMeta[] = [
  {
    key: 'matched',
    label: 'You anticipated',
    blurb: 'Ideas you predicted that the section also covers.',
    tone: 'match',
  },
  {
    key: 'missing',
    label: 'The section also covers',
    blurb: "Key ideas the article explains that you didn't mention.",
    tone: 'gap',
  },
  {
    key: 'surprising',
    label: 'New from the article',
    blurb: "Specifics the article highlights that you didn't predict.",
    tone: 'extra',
  },
  {
    key: 'incorrect',
    label: 'Worth a second look',
    blurb: "You mentioned these; this section doesn't address them.",
    tone: 'check',
  },
]

export function PredictComparisonPanel({
  comparison,
  prediction,
}: PredictComparisonPanelProps) {
  if (isEmptyComparison(comparison)) {
    return (
      <div className='kb-pred-compare is-empty'>
        <p className='kb-pred-compare-empty'>
          Read on and compare it against what you expected.
        </p>
      </div>
    )
  }

  const visible = BUCKETS.filter((b) => comparison[b.key].length > 0)

  return (
    <div className='kb-pred-compare' aria-label='Prediction comparison'>
      <p className='kb-pred-compare-eyebrow'>Prediction vs. article</p>
      {prediction && (
        <blockquote className='kb-pred-compare-yours'>{prediction}</blockquote>
      )}
      <div className='kb-pred-compare-grid'>
        {visible.map((bucket) => (
          <section
            key={bucket.key}
            className={`kb-pred-bucket kb-pred-bucket--${bucket.tone}`}
          >
            <header className='kb-pred-bucket-head'>
              <span className='kb-pred-bucket-label'>{bucket.label}</span>
              <span className='kb-pred-bucket-count' aria-hidden='true'>
                {comparison[bucket.key].length}
              </span>
            </header>
            <p className='kb-pred-bucket-blurb'>{bucket.blurb}</p>
            <ul className='kb-pred-bucket-list'>
              {comparison[bucket.key].map((item) => (
                <li key={item} className='kb-pred-bucket-item'>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className='kb-pred-compare-foot'>
        A quick mirror of your mental model — nothing here is saved as a note or
        concept.
      </p>
    </div>
  )
}
