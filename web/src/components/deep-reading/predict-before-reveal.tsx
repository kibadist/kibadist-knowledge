'use client'

import { useId, useMemo, useState } from 'react'

import {
  type ArticleSectionV2,
  type LearningAffordance,
  orderedBlocks,
  sectionKeyTerms,
} from '@/lib/article-v2'
import {
  comparePrediction,
  PREDICT_PROMPT,
  type PredictionComparison,
  predictOrientation,
} from '@/lib/predict-comparison'

import { DeepReadingBlock } from './deep-reading-block'
import { PredictComparisonPanel } from './predict-comparison-panel'
import { SectionCompletionMarkers } from './section-actions'

/**
 * Predict Before Reveal — one section (DET-282).
 *
 * Before the section's prose is revealed, the learner sees only the heading, the
 * visible key terms, and a neutral one-line context, then answers "what do you
 * think this section will explain?". After they submit (or skip) the section is
 * revealed and a lightweight comparison mirrors their prediction against the
 * article.
 *
 * The hard guarantees from the ticket live here:
 *  - The section content is NOT rendered until the learner submits or skips
 *    (`phase === 'revealed'`). There is no hidden DOM to peek at.
 *  - Skipping reveals the section without a prediction and never blocks reading.
 *  - Submitting emits `prediction_submitted` + `section_revealed` (and, when the
 *    comparison is non-trivial, `comparison_generated`); skipping emits only
 *    `section_revealed`. Emission is delegated to the parent so all events flow
 *    through the one shared learning store (DET-278).
 *  - Nothing here mints a concept or a note — the prediction is user activity,
 *    not validated knowledge (DET-278).
 */
export interface PredictBeforeRevealProps {
  section: ArticleSectionV2
  /** 1-based position for the eyebrow and orientation line. */
  index: number
  total: number
  /** Affordances already completed in this section (drives the markers). */
  completed: Set<LearningAffordance>
  /** Highlight key terms inside the revealed prose. */
  highlightKeyTerms: boolean
  /** Submit a prediction: parent emits prediction_submitted + reveal + compare. */
  onSubmit: (
    section: ArticleSectionV2,
    prediction: string,
    comparison: PredictionComparison,
  ) => void
  /** Skip prediction: parent emits section_revealed only. */
  onSkip: (section: ArticleSectionV2) => void
  /** Ref-setter so the parent can scroll a section into view. */
  registerRef?: (sectionId: string, el: HTMLElement | null) => void
}

type Phase = 'prompt' | 'revealed'

export function PredictBeforeReveal({
  section,
  index,
  total,
  completed,
  highlightKeyTerms,
  onSubmit,
  onSkip,
  registerRef,
}: PredictBeforeRevealProps) {
  const [phase, setPhase] = useState<Phase>('prompt')
  const [draft, setDraft] = useState('')
  const [prediction, setPrediction] = useState<string | null>(null)
  const fieldId = useId()

  const keyTerms = useMemo(() => sectionKeyTerms(section), [section])
  const blocks = useMemo(() => orderedBlocks(section), [section])
  const termStrings = useMemo(
    () => (highlightKeyTerms ? keyTerms.map((k) => k.term) : []),
    [highlightKeyTerms, keyTerms],
  )
  const orientation = useMemo(
    () => predictOrientation(section, index, total),
    [section, index, total],
  )

  const comparison = useMemo(
    () => (prediction ? comparePrediction(section, prediction) : null),
    [prediction, section],
  )

  const handleSubmit = () => {
    const text = draft.trim()
    if (!text) return
    const result = comparePrediction(section, text)
    setPrediction(text)
    setPhase('revealed')
    onSubmit(section, text, result)
  }

  const handleSkip = () => {
    setPrediction(null)
    setPhase('revealed')
    onSkip(section)
  }

  return (
    <section
      id={section.section_id}
      ref={(el) => registerRef?.(section.section_id, el)}
      className={`kb-pred-section${phase === 'revealed' ? ' is-revealed' : ''}`}
      aria-label={section.heading}
    >
      <header className='kb-dr-section-head'>
        <p className='kb-dr-section-eyebrow'>
          <span className='kb-dr-section-num'>
            {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
          {phase === 'prompt' ? (
            <span className='kb-pred-stage' aria-hidden='true'>
              Predict
            </span>
          ) : (
            completed.size > 0 && (
              <span className='kb-dr-section-badge' aria-hidden='true'>
                ✓ {completed.size}
              </span>
            )
          )}
        </p>
        <h2 className='kb-dr-section-title kb-h2'>{section.heading}</h2>
      </header>

      {phase === 'prompt' ? (
        <div className='kb-pred-card'>
          {orientation && <p className='kb-pred-orient'>{orientation}</p>}

          {keyTerms.length > 0 && (
            <div
              className='kb-pred-terms'
              role='group'
              aria-label={`Key terms in ${section.heading}`}
            >
              {keyTerms.map((term) => (
                <span key={term.term} className='kb-pred-term'>
                  {term.term}
                </span>
              ))}
            </div>
          )}

          <label className='kb-pred-prompt' htmlFor={fieldId}>
            {PREDICT_PROMPT}
          </label>
          <textarea
            id={fieldId}
            className='kb-pred-input'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='Bring your current understanding to the surface, in a sentence or two…'
            rows={4}
            // Submit on Cmd/Ctrl+Enter; plain Enter keeps making paragraphs.
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
            }}
          />

          <div className='kb-pred-actions'>
            <button
              type='button'
              className='kb-pred-submit'
              onClick={handleSubmit}
              disabled={draft.trim().length === 0}
            >
              Reveal &amp; compare
            </button>
            <button type='button' className='kb-pred-skip' onClick={handleSkip}>
              Skip prediction
            </button>
          </div>
          <p className='kb-pred-hint'>
            No wrong answers — this just surfaces your model before the article
            shows its own. You can always skip.
          </p>
        </div>
      ) : (
        <>
          <div className='kb-reader-content kb-dr-prose'>
            {blocks.map((block) => (
              <DeepReadingBlock
                key={block.block_id}
                block={block}
                keyTerms={termStrings}
              />
            ))}
          </div>

          {comparison && (
            <PredictComparisonPanel
              comparison={comparison}
              prediction={prediction ?? undefined}
            />
          )}

          <SectionCompletionMarkers completed={completed} />
        </>
      )}
    </section>
  )
}
