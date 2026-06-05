'use client'

import { useCallback, useMemo, useState } from 'react'

import type { ArticleLearningState } from '@/lib/article-learning-events'
import type { ArticleV2 } from '@/lib/article-v2'
import {
  generateReviewPrompts,
  groupReviewPrompts,
  hasMinimumPromptVariety,
  promptTypeGroup,
  REVIEW_PROMPT_GROUP_LABEL,
  type ReviewPrompt,
} from '@/lib/spaced-review'

import {
  type ReviewPromptApproval,
  ReviewPromptCard,
  type ReviewPromptDecision,
} from './review-prompt-card'

/**
 * Spaced Review Mode (DET-288) — the mode-level host.
 *
 * The mode that gives a finished article a path into later retrieval. After the
 * learner predicts, rewrites, compares, or extracts concepts, this mode proposes
 * a small set of review prompts built from their own explanations and validated
 * concepts (with source-grounded article claims only as a fallback), groups them
 * by type, and lets the learner approve, edit, or reject each before anything is
 * scheduled.
 *
 * It owns event emission through the shared store and the DET-288 vocabulary:
 *   - `review_prompt_approved` — emitted on approval, carrying the prompt
 *     identity, type, originating event, and concept so a later review links back.
 *   - `review_completed` — owned by the Retrieval Engine review session, not this
 *     surface; the contract builder for it lives in the server module.
 *
 * Boundaries (DET-278): the Retrieval Engine stores schedules; this surface only
 * proposes and hands off. Approved prompts flow to an explicit `onSchedulePrompt`
 * sink (the Retrieval Engine write), mirroring how events flow to `onEmit`.
 * Nothing is scheduled without the learner's approval (§4); rejection schedules
 * nothing.
 */

/** A prompt the learner approved, handed to the Retrieval Engine sink. */
export interface ScheduledReviewPrompt extends ReviewPrompt {
  status: 'approved'
}

export interface SpacedReviewModeProps {
  article: ArticleV2
  /** Shared learning-event store; the approval event flows through it. */
  learning: ArticleLearningState
  /** Section to scope to on entry (from a section action). */
  focusSectionId?: string | null
  /** Whether the original source spans behind the article are available (§5). */
  sourceAvailable?: boolean
  /** Retrieval Engine sink — called when a prompt is approved (drop-in write). */
  onSchedulePrompt?: (prompt: ScheduledReviewPrompt) => void
  /** Hand back to full guided reading (Deep Reading Mode). */
  onStartReading: () => void
}

type Scope = 'article' | 'section'

export function SpacedReviewMode({
  article,
  learning,
  focusSectionId,
  sourceAvailable,
  onSchedulePrompt,
  onStartReading,
}: SpacedReviewModeProps) {
  // Step 1 (DET-288 UX): the learner asks for prompts; we don't pre-generate.
  const [created, setCreated] = useState(false)
  const [scope, setScope] = useState<Scope>(
    focusSectionId ? 'section' : 'article',
  )
  const [decisions, setDecisions] = useState<
    Record<string, ReviewPromptDecision>
  >({})

  const activeSectionId = focusSectionId ?? null

  // Generated from the learning-event log. Stable prompt ids mean decisions made
  // below survive a re-generation when new events arrive.
  const allPrompts = useMemo(
    () => generateReviewPrompts(article, learning.events, { sourceAvailable }),
    [article, learning.events, sourceAvailable],
  )

  const prompts = useMemo(() => {
    if (scope === 'section' && activeSectionId) {
      return allPrompts.filter((p) => p.section_id === activeSectionId)
    }
    return allPrompts
  }, [allPrompts, scope, activeSectionId])

  const grouped = useMemo(() => groupReviewPrompts(prompts), [prompts])
  const variety = useMemo(() => hasMinimumPromptVariety(prompts), [prompts])

  const approvedCount = useMemo(
    () =>
      Object.values(decisions).filter((d) => d.status === 'approved').length,
    [decisions],
  )

  const handleApprove = useCallback(
    (promptId: string, approval: ReviewPromptApproval) => {
      const prompt = allPrompts.find((p) => p.prompt_id === promptId)
      if (!prompt) return

      setDecisions((prev) => ({
        ...prev,
        [promptId]: { status: 'approved', approval },
      }))

      // Source of truth: the approval event (DET-278 §2). The edited question
      // rides in `prompt`; identity needed to reconcile with the Retrieval
      // Engine and to link a later review back to the section/concept.
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: prompt.section_id,
        source_span_ids: prompt.source_span_ids,
        event_type: 'review_prompt_approved',
        prompt: approval.question,
        metadata: {
          surface: 'spaced_review',
          prompt_id: prompt.prompt_id,
          prompt_type: prompt.prompt_type,
          prompt_group: promptTypeGroup(prompt.prompt_type),
          concept_id: prompt.concept_id,
          created_from_event_id: prompt.created_from_event_id,
          origin: prompt.origin,
          expected_answer_summary: approval.expected_answer_summary,
        },
      })

      // Retrieval Engine write (drop-in). Distinct from the event log: the
      // engine owns the schedule; we only forward the approved prompt.
      onSchedulePrompt?.({
        ...prompt,
        question: approval.question,
        expected_answer_summary: approval.expected_answer_summary,
        status: 'approved',
      })
    },
    [allPrompts, article, learning, onSchedulePrompt],
  )

  const handleReject = useCallback((promptId: string) => {
    setDecisions((prev) => ({
      ...prev,
      [promptId]: { status: 'rejected' },
    }))
  }, [])

  const handleReset = useCallback((promptId: string) => {
    setDecisions((prev) => {
      const next = { ...prev }
      delete next[promptId]
      return next
    })
  }, [])

  // --- Pre-create CTA (step 1) ----------------------------------------------
  if (!created) {
    return (
      <div className='kb-sr'>
        <div className='kb-sr-intro'>
          <p className='kb-sr-lede'>
            An article isn’t learned when it’s read — it’s learned when you can
            retrieve it later. Turn what you just worked through into a small
            set of spaced review prompts, built from your own explanations and
            the concepts you saved.
          </p>
          <div className='kb-sr-cta-row'>
            <button
              type='button'
              className='kb-sr-cta'
              onClick={() => setCreated(true)}
              disabled={allPrompts.length === 0}
            >
              Create review prompts
            </button>
            <button
              type='button'
              className='kb-sr-cta kb-sr-cta--ghost'
              onClick={onStartReading}
            >
              Back to reading
              <span aria-hidden='true'> →</span>
            </button>
          </div>
          {allPrompts.length === 0 && (
            <p className='kb-sr-empty-note'>
              Nothing to review yet. Read, rewrite, compare, or extract concepts
              first — review prompts are built from what you do.
            </p>
          )}
        </div>
      </div>
    )
  }

  // --- Proposed prompts (steps 2–5) -----------------------------------------
  return (
    <div className='kb-sr'>
      <div className='kb-sr-intro'>
        <p className='kb-sr-lede'>
          Approve the prompts worth keeping, edit a question, or reject the
          rest. The strongest prompts come from <strong>your own words</strong>.
          Nothing is scheduled until you approve it.
        </p>
        <button
          type='button'
          className='kb-sr-cta kb-sr-cta--ghost'
          onClick={onStartReading}
        >
          Back to reading
          <span aria-hidden='true'> →</span>
        </button>
      </div>

      <div className='kb-sr-toolbar'>
        <div className='kb-sr-scope' role='group' aria-label='Review scope'>
          <button
            type='button'
            className={`kb-sr-scope-btn${scope === 'article' ? ' on' : ''}`}
            aria-pressed={scope === 'article'}
            onClick={() => setScope('article')}
          >
            Whole article
          </button>
          <button
            type='button'
            className={`kb-sr-scope-btn${scope === 'section' ? ' on' : ''}`}
            aria-pressed={scope === 'section'}
            onClick={() => setScope('section')}
            disabled={!activeSectionId}
          >
            This section
          </button>
        </div>
        <p className='kb-sr-count'>
          {prompts.length} prompt{prompts.length === 1 ? '' : 's'} ·{' '}
          {approvedCount} approved
        </p>
      </div>

      {!variety && prompts.length > 0 && (
        <p className='kb-sr-variety-note'>
          Do more active recall (rewrite, compare, or extract concepts) to
          unlock misconception-repair and transfer prompts.
        </p>
      )}

      {prompts.length === 0 ? (
        <p className='kb-sr-empty-note'>
          No prompts for this scope yet.{' '}
          {scope === 'section' && 'Try the whole article.'}
        </p>
      ) : (
        <div className='kb-sr-groups'>
          {grouped.map(({ group, prompts: groupPrompts }) => (
            <section
              key={group}
              className='kb-sr-group'
              aria-label={REVIEW_PROMPT_GROUP_LABEL[group]}
            >
              <header className='kb-sr-group-head'>
                <h2 className='kb-sr-group-title kb-h2'>
                  {REVIEW_PROMPT_GROUP_LABEL[group]}
                </h2>
                <span className='kb-sr-group-count'>{groupPrompts.length}</span>
              </header>
              {groupPrompts.map((prompt: ReviewPrompt) => (
                <ReviewPromptCard
                  key={prompt.prompt_id}
                  prompt={prompt}
                  decision={decisions[prompt.prompt_id] ?? null}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onReset={handleReset}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      <p className='kb-sr-foot'>
        AI proposes review; you decide what gets scheduled. Approved prompts
        enter your Retrieval Engine and link back to the section and concept
        they came from.
      </p>
    </div>
  )
}
