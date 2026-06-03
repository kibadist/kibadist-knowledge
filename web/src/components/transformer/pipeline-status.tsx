'use client'

import type { TransformerSourceStatus } from '@/lib/api'
import {
  SOURCE_PIPELINE_STEPS,
  sourceStepIndex,
} from '@/lib/transformer-format'

/**
 * The ordered pipeline step indicator for a source: Ingested → Extracting →
 * Segmented → Classifying → Ready. The active step animates while the pipeline
 * runs; a failure paints the line up to where it stopped in the accent tone.
 */
export function PipelineStatus({
  status,
}: {
  status: TransformerSourceStatus
}) {
  const current = sourceStepIndex(status)
  const failed = status === 'EXTRACTION_FAILED' || status === 'FAILED'

  return (
    <ol className='tf-steps' aria-label='Pipeline progress'>
      {SOURCE_PIPELINE_STEPS.map((step, i) => {
        const done = i < current || (status === 'READY' && i <= current)
        const active = i === current && status !== 'READY' && !failed
        const state = done ? 'is-done' : active ? 'is-active' : 'is-todo'
        return (
          <li
            key={step.key}
            className={`tf-step ${state}${failed && i === current ? ' is-failed' : ''}`}
          >
            <span className='tf-step-dot' aria-hidden='true' />
            <span className='tf-step-label'>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
