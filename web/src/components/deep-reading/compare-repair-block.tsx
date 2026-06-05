'use client'

import { useCallback, useId, useState } from 'react'

import type { ArticleBlockV2 } from '@/lib/article-v2'
import type { RewriteComparison } from '@/lib/compare-repair'
import { isRewritableBlock, rewriteBlockNoun } from '@/lib/rewrite-block'

import { CompareFeedbackPanel } from './compare-feedback-panel'
import { DeepReadingBlock } from './deep-reading-block'

/**
 * Compare & Repair — one reconstruction (DET-286).
 *
 * Shows a single submitted reconstruction next to the source block it targets,
 * the structured comparison feedback, and a "try again" editor for one improved
 * attempt. The mechanics the ticket pins down live here:
 *  - The source is *revealed* (Compare is the feedback step, not a recall step):
 *    the learner can finally see what they were reconstructing.
 *  - Their current answer is echoed verbatim; when they've revised, the version
 *    is labelled so the latest is clearly the preferred user-authored explanation.
 *  - The revise editor lets them rewrite after seeing feedback; submitting hands
 *    the new text to the parent, which emits `rewrite_revised` and a fresh
 *    `comparison_generated` so the feedback updates honestly.
 *  - Nothing here mints a concept, note, or scheduled prompt (DET-278 §4).
 */
export interface CompareRepairBlockProps {
  block: ArticleBlockV2
  /** 1-based position among the section's compared blocks. */
  index: number
  total: number
  /** The learner's current answer (latest revision, else the submitted rewrite). */
  currentAnswer: string
  /** How many revisions have been saved (0 = only the original rewrite). */
  revisionCount: number
  /** The comparison computed for {@link currentAnswer}. */
  comparison: RewriteComparison
  /** Submit a revised reconstruction — parent emits `rewrite_revised`. */
  onRevise: (block: ArticleBlockV2, revised: string) => void
  /** Scroll this card into view on mount (entry focus target). */
  autoFocus?: boolean
}

export function CompareRepairBlock({
  block,
  index,
  total,
  currentAnswer,
  revisionCount,
  comparison,
  onRevise,
  autoFocus,
}: CompareRepairBlockProps) {
  const fieldId = useId()
  const [revising, setRevising] = useState(false)
  const [draft, setDraft] = useState('')

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      if (el && autoFocus) {
        const reduceMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
        el.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        })
      }
    },
    [autoFocus],
  )

  const startRevise = useCallback(() => {
    setDraft(currentAnswer)
    setRevising(true)
  }, [currentAnswer])

  const submitRevise = useCallback(() => {
    const text = draft.trim()
    // No-op when empty or unchanged — a revision must actually change something.
    if (!text || text === currentAnswer.trim()) {
      setRevising(false)
      return
    }
    onRevise(block, text)
    setRevising(false)
  }, [block, draft, currentAnswer, onRevise])

  const noun = isRewritableBlock(block) ? rewriteBlockNoun(block) : block.type
  const versionLabel =
    revisionCount > 0 ? `Revision ${revisionCount}` : 'Your reconstruction'

  return (
    <section
      ref={setRef}
      className='kb-cmp-block'
      aria-label={`Compare ${noun}`}
    >
      <header className='kb-cmp-block-head'>
        <span className='kb-cmp-block-num'>
          {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <span className='kb-cmp-block-noun'>{noun}</span>
        {revisionCount > 0 && (
          <span className='kb-cmp-block-badge' aria-hidden='true'>
            ✓ revised
          </span>
        )}
      </header>

      <div className='kb-cmp-columns'>
        <div className='kb-cmp-col'>
          <p className='kb-cmp-col-eyebrow'>{versionLabel}</p>
          <blockquote className='kb-cmp-yours'>{currentAnswer}</blockquote>
        </div>
        <div className='kb-cmp-col'>
          <p className='kb-cmp-col-eyebrow'>The block</p>
          <div className='kb-cmp-source kb-reader-content kb-dr-prose'>
            <DeepReadingBlock block={block} />
          </div>
        </div>
      </div>

      <CompareFeedbackPanel comparison={comparison} />

      {!revising ? (
        <div className='kb-cmp-actions'>
          <button
            type='button'
            className='kb-cmp-revise-cta'
            onClick={startRevise}
          >
            {comparison.revision_requested
              ? 'Revise your answer'
              : 'Refine anyway'}
          </button>
          {comparison.revision_requested && (
            <span className='kb-cmp-actions-hint'>
              One improved attempt — close the gaps above.
            </span>
          )}
        </div>
      ) : (
        <div className='kb-cmp-editor'>
          <label className='kb-cmp-prompt' htmlFor={fieldId}>
            Rewrite it, addressing the feedback
          </label>
          <textarea
            id={fieldId}
            className='kb-cmp-input'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='Your improved explanation…'
            rows={5}
            // Submit on Cmd/Ctrl+Enter; plain Enter keeps making paragraphs.
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitRevise()
            }}
          />
          <div className='kb-cmp-editor-row'>
            <button
              type='button'
              className='kb-cmp-cancel'
              onClick={() => setRevising(false)}
            >
              Cancel
            </button>
            <button
              type='button'
              className='kb-cmp-submit'
              onClick={submitRevise}
              disabled={
                draft.trim().length === 0 ||
                draft.trim() === currentAnswer.trim()
              }
            >
              Save revision
            </button>
          </div>
          <p className='kb-cmp-editor-hint'>
            Your revision is saved as the preferred version — meaning over
            wording, and never as a note or concept.
          </p>
        </div>
      )}
    </section>
  )
}
