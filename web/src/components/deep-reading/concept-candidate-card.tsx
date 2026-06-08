'use client'

import { useCallback, useId, useMemo, useState } from 'react'

import {
  CONCEPT_ORIGIN_LABEL,
  CONCEPT_STATUS_LABEL,
  type ConceptCandidate,
  type ConceptCandidateStatus,
  resolveApprovedStatus,
} from '@/lib/concept-extraction'

/**
 * Concept Extraction — one candidate card (DET-287).
 *
 * Presents a single concept candidate and lets the learner approve, edit, or
 * reject it. The card encodes the rules the ticket pins down:
 *  - AI vs. user-authored is *visually distinguished* (AC): the source-grounded
 *    definition is labelled as AI-suggested; the learner's explanation is its own
 *    user-authored panel and the two are never merged.
 *  - Edit means edit the definition; the original AI suggestion can be reworded.
 *  - A concept only becomes `user_validated` once the learner has provided or
 *    approved an explanation — otherwise approval saves a `draft` (validation
 *    rule). The approve button's label makes that consequence visible.
 *  - The learner's Rewrite-Mode snippet (DET-285), when present, is offered as a
 *    supporting explanation they can adopt in one click — never auto-adopted.
 *  - Retrieval prompts are opt-in and *suggested only*; nothing here schedules
 *    them (DET-278 §4).
 */

/** The edited fields a learner commits when approving a candidate. */
export interface ConceptApproval {
  /** The (possibly edited) definition saved with the concept. */
  definition: string
  /** The learner's explanation, verbatim — drives `user_validated` vs `draft`. */
  user_explanation?: string
  why_it_matters?: string
  /** The retrieval prompts the learner kept (suggested, never scheduled). */
  retrieval_prompts: string[]
  /** The status this approval earns (derived from the explanation). */
  status: Extract<ConceptCandidateStatus, 'draft' | 'user_validated'>
}

/** A committed decision tracked by the mode for a candidate. */
export interface ConceptDecision {
  status: ConceptCandidateStatus
  approval?: ConceptApproval
}

export interface ConceptCandidateCardProps {
  candidate: ConceptCandidate
  /** Committed decision, if the learner has acted on this candidate. */
  decision?: ConceptDecision | null
  onApprove: (candidateId: string, approval: ConceptApproval) => void
  onReject: (candidateId: string) => void
  /** Revert a decided candidate back to suggested (re-open it). */
  onReset: (candidateId: string) => void
  /** Scroll this card into view on mount (section-entry focus target). */
  autoFocus?: boolean
}

export function ConceptCandidateCard({
  candidate,
  decision,
  onApprove,
  onReject,
  onReset,
  autoFocus,
}: ConceptCandidateCardProps) {
  const defId = useId()
  const explId = useId()

  const [definition, setDefinition] = useState(candidate.definition)
  const [editingDef, setEditingDef] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [kept, setKept] = useState<Set<string>>(
    () => new Set(candidate.retrieval_prompt_candidates),
  )

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

  const adoptRewrite = useCallback(() => {
    if (candidate.rewrite_snippet) setExplanation(candidate.rewrite_snippet)
  }, [candidate.rewrite_snippet])

  const togglePrompt = useCallback((prompt: string) => {
    setKept((prev) => {
      const next = new Set(prev)
      if (next.has(prompt)) next.delete(prompt)
      else next.add(prompt)
      return next
    })
  }, [])

  // What status approval would earn right now — surfaced on the button so the
  // learner sees that an explanation is what makes a concept "validated".
  const wouldBe = resolveApprovedStatus(explanation)

  const approve = useCallback(() => {
    const trimmedExpl = explanation.trim()
    const keptPrompts = candidate.retrieval_prompt_candidates.filter((p) =>
      kept.has(p),
    )
    onApprove(candidate.candidate_id, {
      definition: definition.trim() || candidate.definition,
      user_explanation: trimmedExpl || undefined,
      why_it_matters: candidate.why_it_matters,
      retrieval_prompts: keptPrompts,
      status: resolveApprovedStatus(trimmedExpl),
    })
  }, [candidate, definition, explanation, kept, onApprove])

  const status: ConceptCandidateStatus = decision?.status ?? candidate.status
  const decided = status === 'user_validated' || status === 'draft'
  const rejected = status === 'rejected'

  const sourceLabel = useMemo(() => {
    const spans = candidate.source_span_ids
    if (spans.length === 0) return 'No source span'
    if (spans.length === 1) return '1 source span'
    return `${spans.length} source spans`
  }, [candidate.source_span_ids])

  return (
    <article
      ref={setRef}
      className={`kb-cx-card kb-cx-card--${status}`}
      aria-label={`Concept candidate: ${candidate.name}`}
    >
      <header className='kb-cx-card-head'>
        <div className='kb-cx-card-titles'>
          <h3 className='kb-cx-name'>{candidate.name}</h3>
          <span className='kb-cx-origin'>
            {CONCEPT_ORIGIN_LABEL[candidate.origin]}
          </span>
        </div>
        <span className={`kb-cx-status kb-cx-status--${status}`}>
          {CONCEPT_STATUS_LABEL[status]}
        </span>
      </header>

      <p className='kb-cx-provenance'>
        From <strong>{candidate.section_heading}</strong> · {sourceLabel}
      </p>

      {/* AI-suggested definition — labelled and visually distinct (AC). */}
      <section className='kb-cx-block kb-cx-block--ai'>
        <div className='kb-cx-block-head'>
          <span className='kb-cx-tag kb-cx-tag--ai'>AI-suggested</span>
          <span className='kb-cx-block-label'>Definition</span>
          {!editingDef && !decided && !rejected && (
            <button
              type='button'
              className='kb-cx-inline-btn'
              onClick={() => setEditingDef(true)}
            >
              Edit
            </button>
          )}
        </div>
        {editingDef ? (
          <textarea
            className='kb-cx-input'
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            rows={3}
            onBlur={() => setEditingDef(false)}
          />
        ) : (
          <p className='kb-cx-def'>{definition}</p>
        )}
        {candidate.why_it_matters && (
          <p className='kb-cx-why'>
            <span className='kb-cx-why-label'>Why it matters</span>
            {candidate.why_it_matters}
          </p>
        )}
      </section>

      {/* User-authored explanation — its own provenance layer (AC + §5). */}
      <section className='kb-cx-block kb-cx-block--user'>
        <div className='kb-cx-block-head'>
          <span className='kb-cx-tag kb-cx-tag--user'>Your words</span>
          <label className='kb-cx-block-label' htmlFor={explId}>
            Explanation
          </label>
          {candidate.rewrite_snippet && !decided && (
            <button
              type='button'
              className='kb-cx-inline-btn'
              onClick={adoptRewrite}
            >
              Use my rewrite
            </button>
          )}
        </div>
        {candidate.rewrite_snippet && (
          <blockquote className='kb-cx-rewrite'>
            <span className='kb-cx-rewrite-label'>From your rewrite</span>
            {candidate.rewrite_snippet}
          </blockquote>
        )}
        {decided ? (
          decision?.approval?.user_explanation ? (
            <p className='kb-cx-def kb-cx-def--user'>
              {decision.approval.user_explanation}
            </p>
          ) : (
            <p className='kb-cx-hint'>
              No explanation yet — saved as a draft until you add one.
            </p>
          )
        ) : (
          <textarea
            id={explId}
            className='kb-cx-input'
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder='Explain this concept in your own words (optional, but it’s what lets you earn it)…'
            rows={3}
          />
        )}
      </section>

      {/* Related concepts + confusion pairs — graph + Living-Concept feed. */}
      {(candidate.related_concepts.length > 0 ||
        candidate.confusion_pairs.length > 0) && (
        <section className='kb-cx-relations'>
          {candidate.related_concepts.length > 0 && (
            <div className='kb-cx-rel'>
              <span className='kb-cx-rel-label'>Related</span>
              <ul className='kb-cx-chips'>
                {candidate.related_concepts.map((c) => (
                  <li key={c} className='kb-cx-chip'>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {candidate.confusion_pairs.length > 0 && (
            <div className='kb-cx-rel'>
              <span className='kb-cx-rel-label'>Don’t confuse with</span>
              <ul className='kb-cx-confusions'>
                {candidate.confusion_pairs.map((p) => (
                  <li key={p.concept} className='kb-cx-confusion'>
                    <span className='kb-cx-confusion-name'>{p.concept}</span>
                    <span className='kb-cx-confusion-cue'>{p.distinction}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Suggested retrieval prompts — opt-in, suggested only (§4). */}
      {candidate.retrieval_prompt_candidates.length > 0 && (
        <section className='kb-cx-prompts'>
          <p className='kb-cx-prompts-head'>
            Suggested retrieval prompts
            <span className='kb-cx-prompts-note'>
              suggested only — scheduled after you validate
            </span>
          </p>
          <ul className='kb-cx-prompt-list'>
            {candidate.retrieval_prompt_candidates.map((prompt) => {
              const on = decided
                ? (decision?.approval?.retrieval_prompts ?? []).includes(prompt)
                : kept.has(prompt)
              const id = `${defId}-${prompt}`
              return (
                <li key={prompt} className='kb-cx-prompt'>
                  <label className='kb-cx-prompt-label' htmlFor={id}>
                    <input
                      id={id}
                      type='checkbox'
                      checked={on}
                      disabled={decided || rejected}
                      onChange={() => togglePrompt(prompt)}
                    />
                    <span>{prompt}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Decision controls. */}
      {decided || rejected ? (
        <div className='kb-cx-actions'>
          <span className='kb-cx-decided'>
            {rejected
              ? 'Rejected — not saved to your Concept Library.'
              : status === 'user_validated'
                ? 'Earned — saved to your concepts.'
                : 'Saved as a draft — add an explanation to earn it.'}
          </span>
          <button
            type='button'
            className='kb-cx-undo'
            onClick={() => onReset(candidate.candidate_id)}
          >
            Undo
          </button>
        </div>
      ) : (
        <div className='kb-cx-actions'>
          <button
            type='button'
            className='kb-cx-reject'
            onClick={() => onReject(candidate.candidate_id)}
          >
            Reject
          </button>
          <button type='button' className='kb-cx-approve' onClick={approve}>
            {wouldBe === 'user_validated' ? 'Earn concept' : 'Approve as draft'}
          </button>
        </div>
      )}
    </article>
  )
}
