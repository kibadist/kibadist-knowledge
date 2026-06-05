'use client'

import { useCallback, useState } from 'react'

import {
  isUserAuthoredOrigin,
  PROMPT_ORIGIN_LABEL,
  REVIEW_PROMPT_TYPE_LABEL,
  type ReviewPrompt,
} from '@/lib/spaced-review'

/**
 * Spaced Review — one review-prompt card (DET-288).
 *
 * Presents a single generated review prompt and lets the learner approve, edit,
 * or reject it before anything is scheduled. The card encodes the rules the
 * ticket pins:
 *  - The prompt's provenance is visible (AC): a chip says where it came from, and
 *    user-authored prompts are marked distinctly from AI/source ones — the
 *    strongest prompts come from the learner's own material.
 *  - Edit means edit the question *and* the expected-answer summary before
 *    approval; the learner owns what gets scheduled.
 *  - Nothing is scheduled here. Approval marks the prompt `approved` and hands it
 *    to the Retrieval Engine through the mode's sink (DET-278 §4).
 *  - The prompt links back to its article section and concept (AC): the card
 *    shows that provenance so a later review can return to the source.
 */

/** The (possibly edited) fields a learner commits when approving a prompt. */
export interface ReviewPromptApproval {
  question: string
  expected_answer_summary: string
}

/** A committed decision tracked by the mode for a prompt. */
export interface ReviewPromptDecision {
  status: 'approved' | 'rejected'
  approval?: ReviewPromptApproval
}

export interface ReviewPromptCardProps {
  prompt: ReviewPrompt
  decision?: ReviewPromptDecision | null
  onApprove: (promptId: string, approval: ReviewPromptApproval) => void
  onReject: (promptId: string) => void
  /** Revert a decided prompt back to suggested (re-open it). */
  onReset: (promptId: string) => void
}

export function ReviewPromptCard({
  prompt,
  decision,
  onApprove,
  onReject,
  onReset,
}: ReviewPromptCardProps) {
  const [question, setQuestion] = useState(prompt.question)
  const [summary, setSummary] = useState(prompt.expected_answer_summary)
  const [editing, setEditing] = useState(false)

  const status = decision?.status ?? 'suggested'
  const decided = status === 'approved' || status === 'rejected'

  const approve = useCallback(() => {
    onApprove(prompt.prompt_id, {
      question: question.trim() || prompt.question,
      expected_answer_summary: summary.trim() || prompt.expected_answer_summary,
    })
    setEditing(false)
  }, [onApprove, prompt, question, summary])

  const userAuthored = isUserAuthoredOrigin(prompt.origin)

  const provenance: string[] = []
  if (prompt.section_heading) provenance.push(prompt.section_heading)
  if (prompt.concept_id) provenance.push('linked concept')
  if (prompt.source_span_ids.length > 0) {
    provenance.push(
      prompt.source_span_ids.length === 1
        ? '1 source span'
        : `${prompt.source_span_ids.length} source spans`,
    )
  }

  return (
    <article
      className={`kb-sr-card kb-sr-card--${status}${userAuthored ? ' is-user' : ''}`}
      aria-label={`Review prompt: ${prompt.subject}`}
    >
      <header className='kb-sr-card-head'>
        <span className='kb-sr-type'>
          {REVIEW_PROMPT_TYPE_LABEL[prompt.prompt_type]}
        </span>
        <span
          className={`kb-sr-origin${userAuthored ? ' kb-sr-origin--user' : ''}`}
        >
          {PROMPT_ORIGIN_LABEL[prompt.origin]}
        </span>
      </header>

      {editing && !decided ? (
        <label className='kb-sr-field'>
          <span className='kb-sr-field-label'>Question</span>
          <textarea
            className='kb-sr-input'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
          />
        </label>
      ) : (
        <p className='kb-sr-question'>
          {decision?.approval?.question ?? question}
        </p>
      )}

      <div className='kb-sr-answer'>
        <span className='kb-sr-answer-label'>Expected answer</span>
        {editing && !decided ? (
          <textarea
            className='kb-sr-input'
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
          />
        ) : (
          <p className='kb-sr-answer-text'>
            {decision?.approval?.expected_answer_summary ?? summary}
          </p>
        )}
      </div>

      {provenance.length > 0 && (
        <p className='kb-sr-provenance'>
          Links back to <strong>{provenance.join(' · ')}</strong>
        </p>
      )}

      {decided ? (
        <div className='kb-sr-actions'>
          <span className='kb-sr-decided'>
            {status === 'approved'
              ? 'Approved — sent to your review schedule.'
              : 'Rejected — not scheduled.'}
          </span>
          <button
            type='button'
            className='kb-sr-undo'
            onClick={() => onReset(prompt.prompt_id)}
          >
            Undo
          </button>
        </div>
      ) : (
        <div className='kb-sr-actions'>
          <button
            type='button'
            className='kb-sr-edit'
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? 'Done editing' : 'Edit'}
          </button>
          <span className='kb-sr-spacer' />
          <button
            type='button'
            className='kb-sr-reject'
            onClick={() => onReject(prompt.prompt_id)}
          >
            Reject
          </button>
          <button type='button' className='kb-sr-approve' onClick={approve}>
            Approve
          </button>
        </div>
      )}
    </article>
  )
}
