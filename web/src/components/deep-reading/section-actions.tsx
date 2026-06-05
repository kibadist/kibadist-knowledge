'use client'

import type { LearningAffordance } from '@/lib/article-v2'

/**
 * Section-level learning entry points (DET-284). These are deliberately quiet:
 * they sit folded into the section and only assert themselves on hover/focus or
 * once the reader reaches the end of a section. Reading comes first; the
 * affordances connect that reading to active recall without demanding it.
 *
 * Each action is just an entry point — the actual exercises live in their own
 * tickets (Predict DET-282, Rewrite DET-285, Compare DET-286, Concept
 * Extraction DET-287, Review DET-288). Deep Reading Mode is the hub.
 */

export interface AffordanceMeta {
  label: string
  /** Short verb shown on the completion marker. */
  done: string
  hint: string
}

export const AFFORDANCE_META: Record<LearningAffordance, AffordanceMeta> = {
  predict: {
    label: 'Predict',
    done: 'Predicted',
    hint: 'Explain this section from its heading before reading.',
  },
  rewrite: {
    label: 'Rewrite',
    done: 'Rewrote',
    hint: 'Reconstruct a block from memory.',
  },
  extract_concepts: {
    label: 'Extract concepts',
    done: 'Concepts extracted',
    hint: 'Turn this section into concept candidates.',
  },
  compare: {
    label: 'Compare',
    done: 'Compared',
    hint: 'Check your rewrite against the article.',
  },
  review: {
    label: 'Review',
    done: 'Reviewed',
    hint: 'Schedule spaced review from this section.',
  },
}

export interface SectionActionsProps {
  affordances: LearningAffordance[]
  /** Affordances already completed in this section (drives markers). */
  completed: Set<LearningAffordance>
  onAction: (affordance: LearningAffordance) => void
  /** Disable interaction (e.g. no handler wired for a mode yet). */
  isAvailable?: (affordance: LearningAffordance) => boolean
}

export function SectionActions({
  affordances,
  completed,
  onAction,
  isAvailable,
}: SectionActionsProps) {
  if (affordances.length === 0) return null
  return (
    <div className='kb-dr-actions' role='group' aria-label='Learning actions'>
      {affordances.map((affordance) => {
        const meta = AFFORDANCE_META[affordance]
        const isDone = completed.has(affordance)
        const available = isAvailable ? isAvailable(affordance) : true
        return (
          <button
            key={affordance}
            type='button'
            className={`kb-dr-action${isDone ? ' is-done' : ''}`}
            onClick={() => onAction(affordance)}
            disabled={!available}
            title={available ? meta.hint : `${meta.label} — coming soon`}
            aria-pressed={isDone}
          >
            <span className='kb-dr-action-mark' aria-hidden='true'>
              {isDone ? '✓' : '+'}
            </span>
            {isDone ? meta.done : meta.label}
          </button>
        )
      })}
    </div>
  )
}

/** Compact completion summary shown in the section margin / progress rail. */
export function SectionCompletionMarkers({
  completed,
}: {
  completed: Set<LearningAffordance>
}) {
  if (completed.size === 0) return null
  return (
    <ul className='kb-dr-markers' aria-label='Completed in this section'>
      {[...completed].map((affordance) => (
        <li key={affordance} className='kb-dr-marker'>
          <span aria-hidden='true'>✓</span> {AFFORDANCE_META[affordance].done}
        </li>
      ))}
    </ul>
  )
}
