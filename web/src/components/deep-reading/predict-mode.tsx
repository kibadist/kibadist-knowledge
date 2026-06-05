'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { ArticleLearningState } from '@/lib/article-learning-events'
import {
  type ArticleSectionV2,
  type ArticleV2,
  type LearningAffordance,
  orderedSections,
} from '@/lib/article-v2'
import {
  isEmptyComparison,
  PREDICT_PROMPT,
  type PredictionComparison,
} from '@/lib/predict-comparison'

import { PredictBeforeReveal } from './predict-before-reveal'

/**
 * Predict Before Reveal Mode (DET-282) — the reading mode that, section by
 * section, asks the learner to explain from the heading and key terms before
 * revealing the prose, then mirrors their prediction against the article.
 *
 * This is the mode-level host. It owns event emission through the one shared
 * learning store (so the reading surface's completion markers stay honest) and
 * the DET-278 event vocabulary for this mode:
 *   - `prediction_submitted` — the learner's verbatim answer + the prompt.
 *   - `section_revealed`      — on submit AND on skip (reading is never blocked).
 *   - `comparison_generated`  — when the comparison has something to show.
 *
 * Provenance (DET-278 §5): the comparison mirrors the learner against the
 * article, so a matched prediction is at most `article_supported_source_unavailable`
 * — never promoted to `source_supported` here (that requires a cited source span,
 * which only the Compare & Repair flow resolves). Predictions never become notes,
 * concepts, or scheduled prompts without later validation.
 */
export interface PredictModeProps {
  article: ArticleV2
  /** Shared learning-event store; all DET-282 events flow through it. */
  learning: ArticleLearningState
  /** Highlight key terms inside revealed prose. */
  highlightKeyTerms: boolean
  /** Section to scroll to on entry (e.g. the section the reader was on). */
  focusSectionId?: string | null
  /** Hand off to full guided reading (Deep Reading Mode). */
  onStartReading: () => void
}

export function PredictMode({
  article,
  learning,
  highlightKeyTerms,
  focusSectionId,
  onStartReading,
}: PredictModeProps) {
  const sections = useMemo(() => orderedSections(article), [article])
  const sectionEls = useRef(new Map<string, HTMLElement>())

  const registerRef = useCallback(
    (sectionId: string, el: HTMLElement | null) => {
      if (el) sectionEls.current.set(sectionId, el)
      else sectionEls.current.delete(sectionId)
    },
    [],
  )

  // On entry, bring the section the reader was last on into view.
  useEffect(() => {
    if (!focusSectionId) return
    const el = sectionEls.current.get(focusSectionId)
    if (!el) return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const id = window.requestAnimationFrame(() =>
      el.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      }),
    )
    return () => window.cancelAnimationFrame(id)
  }, [focusSectionId])

  const emitReveal = useCallback(
    (section: ArticleSectionV2) =>
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        source_span_ids: section.source_span_ids,
        event_type: 'section_revealed',
        metadata: {
          surface: 'predict_before_reveal',
          // DET-282 data requirement: which blocks the reveal exposed.
          revealed_block_ids: section.blocks.map((b) => b.block_id),
        },
      }),
    [article, learning],
  )

  const handleSubmit = useCallback(
    (
      section: ArticleSectionV2,
      prediction: string,
      comparison: PredictionComparison,
    ) => {
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        event_type: 'prediction_submitted',
        prompt: PREDICT_PROMPT,
        user_answer: prediction,
        metadata: { surface: 'predict_before_reveal' },
      })
      emitReveal(section)
      if (!isEmptyComparison(comparison)) {
        learning.emit({
          article_id: article.article_id,
          article_version_id: article.article_version_id,
          section_id: section.section_id,
          source_span_ids: section.source_span_ids,
          event_type: 'comparison_generated',
          prompt: PREDICT_PROMPT,
          user_answer: prediction,
          ai_feedback: {
            preserved: comparison.matched,
            missing: comparison.missing,
            unsupported: comparison.incorrect,
            // The comparison mirrors learner vs. article, not learner vs.
            // source: a match is article-supported at best (DET-278 §5).
            source_confidence: section.source_span_ids?.length
              ? 'article_supported_source_unavailable'
              : 'user_authored_unsourced',
          },
          metadata: {
            surface: 'predict_before_reveal',
            surprising: comparison.surprising,
          },
        })
      }
    },
    [article, learning, emitReveal],
  )

  const handleSkip = useCallback(
    (section: ArticleSectionV2) => {
      emitReveal(section)
    },
    [emitReveal],
  )

  const completedFor = useCallback(
    (sectionId: string): Set<LearningAffordance> =>
      learning.progressBySection.get(sectionId)?.completed ?? EMPTY_SET,
    [learning],
  )

  const predicted = sections.filter((s) =>
    completedFor(s.section_id).has('predict'),
  ).length

  return (
    <div className='kb-pred'>
      <div className='kb-pred-intro'>
        <p className='kb-pred-lede'>
          Predict before you read. For each section, explain what you think it
          will cover from its heading and key terms — then reveal the article
          and see how your model compares. Skipping is always fine.
        </p>
        <button type='button' className='kb-pred-cta' onClick={onStartReading}>
          Just read instead
          <span aria-hidden='true'> →</span>
        </button>
      </div>

      <div className='kb-pred-sections'>
        {sections.map((section, i) => (
          <PredictBeforeReveal
            key={section.section_id}
            section={section}
            index={i + 1}
            total={sections.length}
            completed={completedFor(section.section_id)}
            highlightKeyTerms={highlightKeyTerms}
            onSubmit={handleSubmit}
            onSkip={handleSkip}
            registerRef={registerRef}
          />
        ))}
      </div>

      <p className='kb-pred-foot'>
        {sections.length} sections · {predicted} predicted · predictions stay as
        activity, not notes.
      </p>
    </div>
  )
}

const EMPTY_SET: Set<LearningAffordance> = new Set()
