'use client'

import { useCallback, useMemo, useState } from 'react'

import type {
  ArticleLearningState,
  ReviewPromptStatus,
} from '@/lib/article-learning-events'
import { type ArticleV2, orderedSections } from '@/lib/article-v2'
import {
  type ConceptCandidate,
  type ConfusionPair,
  conceptIdForCandidate,
  extractArticleConcepts,
  type UserRewriteSnippet,
} from '@/lib/concept-extraction'

import {
  type ConceptApproval,
  ConceptCandidateCard,
  type ConceptDecision,
} from './concept-candidate-card'

/**
 * Concept Extraction Mode (DET-287) — the mode-level host.
 *
 * The mode that turns a *read* article into validated, durable knowledge. It
 * proposes concept candidates from the article (reusing Overview-Mode key terms
 * and any generator-seeded concepts), surfaces each with source provenance, the
 * learner's own rewrite snippet when Rewrite Mode (DET-285) has run, related
 * concepts, confusion pairs and suggested retrieval prompts — and lets the
 * learner approve, edit, or reject each one.
 *
 * It owns event emission through the shared store and the DET-278 vocabulary for
 * this mode:
 *   - `concept_candidate_approved` — emitted only on the learner's approval, with
 *     `metadata.concept_candidate_id` and the minted `metadata.concept_id`.
 *
 * Boundaries (DET-278): the Concept Library is *not* the source of truth — the
 * approval event is. Saving a durable concept happens through an explicit
 * `onSaveConcept` sink (a drop-in for the Concept Library write), mirroring how
 * events flow to `onEmit`. Retrieval prompts are forwarded as `suggested` only;
 * nothing here schedules review (§4). Rejection never touches the Library.
 */
export interface SavedConcept {
  concept_id: string
  candidate_id: string
  article_id: string
  article_version_id?: string
  section_id: string
  name: string
  definition: string
  why_it_matters?: string
  user_explanation?: string
  related_concepts: string[]
  confusion_pairs: ConfusionPair[]
  /** Retrieval prompts the learner kept — suggested until the concept validates. */
  retrieval_prompts: { status: ReviewPromptStatus; prompts: string[] }
  /** Library status: `draft` until the learner has provided an explanation. */
  status: Extract<ConceptDecision['status'], 'draft' | 'user_validated'>
}

export interface ConceptExtractionModeProps {
  article: ArticleV2
  /** Shared learning-event store; the approval event flows through it. */
  learning: ArticleLearningState
  /** Section to scope to / scroll to on entry (from a section action). */
  focusSectionId?: string | null
  /** Concept Library sink — called when a candidate is approved (drop-in write). */
  onSaveConcept?: (concept: SavedConcept) => void
  /** Hand off to full guided reading (Deep Reading Mode). */
  onStartReading: () => void
}

type Scope = 'article' | 'section'

export function ConceptExtractionMode({
  article,
  learning,
  focusSectionId,
  onSaveConcept,
  onStartReading,
}: ConceptExtractionModeProps) {
  const sections = useMemo(() => orderedSections(article), [article])

  // Mine the learner's submitted reconstructions (DET-285) for supporting
  // explanations. Newest last; both the original rewrite and any revision count.
  const userRewrites = useMemo<UserRewriteSnippet[]>(() => {
    const out: UserRewriteSnippet[] = []
    for (const event of learning.events) {
      if (
        (event.event_type === 'block_rewrite_submitted' ||
          event.event_type === 'rewrite_revised') &&
        typeof event.user_answer === 'string' &&
        event.user_answer.trim() &&
        event.section_id
      ) {
        out.push({
          section_id: event.section_id,
          block_id: event.block_id,
          text: event.user_answer,
        })
      }
    }
    return out
  }, [learning.events])

  // All candidates across the article. Stable candidate ids mean decisions made
  // below survive a re-extraction when a new rewrite arrives.
  const candidates = useMemo(
    () => extractArticleConcepts(article, { userRewrites }),
    [article, userRewrites],
  )

  // Scope: a section entry-point scopes to that section by default; the learner
  // can widen to the whole article. With no focus we extract the whole article.
  const [scope, setScope] = useState<Scope>(
    focusSectionId ? 'section' : 'article',
  )
  const activeSectionId = focusSectionId ?? sections[0]?.section_id ?? null

  const visibleCandidates = useMemo(() => {
    if (scope === 'section' && activeSectionId) {
      return candidates.filter((c) => c.section_id === activeSectionId)
    }
    return candidates
  }, [candidates, scope, activeSectionId])

  // Per-candidate decisions (approve/reject), keyed by stable candidate id.
  const [decisions, setDecisions] = useState<Record<string, ConceptDecision>>(
    {},
  )

  const handleApprove = useCallback(
    (candidateId: string, approval: ConceptApproval) => {
      const candidate = candidates.find((c) => c.candidate_id === candidateId)
      if (!candidate) return
      const concept_id = conceptIdForCandidate(candidate.name)

      setDecisions((prev) => ({
        ...prev,
        [candidateId]: { status: approval.status, approval },
      }))

      // Source of truth: the approval event (DET-278 §2). `user_answer` holds the
      // learner's explanation verbatim; structured concept data goes in metadata.
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: candidate.section_id,
        source_span_ids: candidate.source_span_ids,
        event_type: 'concept_candidate_approved',
        user_answer: approval.user_explanation,
        metadata: {
          surface: 'concept_extraction',
          concept_candidate_id: candidate.candidate_id,
          concept_id,
          name: candidate.name,
          definition: approval.definition,
          why_it_matters: approval.why_it_matters,
          related_concepts: candidate.related_concepts,
          confusion_pairs: candidate.confusion_pairs,
          origin: candidate.origin,
          status: approval.status,
          // Retrieval Engine feed — suggested only, never scheduled here (§4).
          retrieval_prompts: {
            status: 'suggested' as ReviewPromptStatus,
            prompts: approval.retrieval_prompts,
          },
        },
      })

      // Durable Concept Library write (drop-in). Distinct from the event log.
      onSaveConcept?.({
        concept_id,
        candidate_id: candidate.candidate_id,
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: candidate.section_id,
        name: candidate.name,
        definition: approval.definition,
        why_it_matters: approval.why_it_matters,
        user_explanation: approval.user_explanation,
        related_concepts: candidate.related_concepts,
        confusion_pairs: candidate.confusion_pairs,
        retrieval_prompts: {
          status: 'suggested',
          prompts: approval.retrieval_prompts,
        },
        status: approval.status,
      })
    },
    [article, candidates, learning, onSaveConcept],
  )

  const handleReject = useCallback((candidateId: string) => {
    setDecisions((prev) => ({
      ...prev,
      [candidateId]: { status: 'rejected' },
    }))
  }, [])

  const handleReset = useCallback((candidateId: string) => {
    setDecisions((prev) => {
      const next = { ...prev }
      delete next[candidateId]
      return next
    })
  }, [])

  const approvedCount = useMemo(
    () =>
      Object.values(decisions).filter(
        (d) => d.status === 'user_validated' || d.status === 'draft',
      ).length,
    [decisions],
  )

  const visibleSections = useMemo(
    () =>
      sections.filter((section) =>
        visibleCandidates.some((c) => c.section_id === section.section_id),
      ),
    [sections, visibleCandidates],
  )

  if (candidates.length === 0) {
    return (
      <div className='kb-cx'>
        <div className='kb-cx-empty'>
          <p className='kb-cx-empty-lede'>
            No concept candidates yet — this article doesn&apos;t surface key
            terms to extract. Read it in <strong>Deep reading</strong> first.
          </p>
          <button type='button' className='kb-cx-cta' onClick={onStartReading}>
            Back to reading
            <span aria-hidden='true'> →</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='kb-cx'>
      <div className='kb-cx-intro'>
        <p className='kb-cx-lede'>
          The article is temporary — these are the ideas worth keeping. Earn the
          concepts that deserve a place in your Concept Library, edit a
          definition, or reject the rest. You <strong>earn</strong> a concept
          only once you explain it in your own words.
        </p>
        <button type='button' className='kb-cx-cta' onClick={onStartReading}>
          Back to reading
          <span aria-hidden='true'> →</span>
        </button>
      </div>

      <div className='kb-cx-toolbar'>
        <div className='kb-cx-scope' role='group' aria-label='Extraction scope'>
          <button
            type='button'
            className={`kb-cx-scope-btn${scope === 'article' ? ' on' : ''}`}
            aria-pressed={scope === 'article'}
            onClick={() => setScope('article')}
          >
            Whole article
          </button>
          <button
            type='button'
            className={`kb-cx-scope-btn${scope === 'section' ? ' on' : ''}`}
            aria-pressed={scope === 'section'}
            onClick={() => setScope('section')}
            disabled={!activeSectionId}
          >
            This section
          </button>
        </div>
        <p className='kb-cx-count'>
          {visibleCandidates.length} candidate
          {visibleCandidates.length === 1 ? '' : 's'} · {approvedCount} saved
        </p>
      </div>

      <div className='kb-cx-sections'>
        {visibleSections.map((section, si) => {
          const sectionCandidates = visibleCandidates.filter(
            (c) => c.section_id === section.section_id,
          )
          return (
            <section
              key={section.section_id}
              className='kb-cx-section'
              aria-label={section.heading}
            >
              <header className='kb-cx-section-head'>
                <span className='kb-cx-section-num'>
                  {String(si + 1).padStart(2, '0')}
                </span>
                <h2 className='kb-cx-section-title kb-h2'>{section.heading}</h2>
              </header>
              {sectionCandidates.map((candidate: ConceptCandidate, ci) => (
                <ConceptCandidateCard
                  key={candidate.candidate_id}
                  candidate={candidate}
                  decision={decisions[candidate.candidate_id] ?? null}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onReset={handleReset}
                  autoFocus={
                    ci === 0 &&
                    scope === 'section' &&
                    section.section_id === focusSectionId
                  }
                />
              ))}
            </section>
          )
        })}
      </div>

      <p className='kb-cx-foot'>
        AI suggests; you decide. Nothing is saved as permanent knowledge until
        you earn it — and prompts are only scheduled once you’ve earned the
        concept.
      </p>
    </div>
  )
}
