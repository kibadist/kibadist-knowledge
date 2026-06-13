'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  type ArticleSectionV2,
  api,
  type LearningConceptCandidate,
  type LearningLayer,
  type MisconceptionCandidate,
  type RetrievalPromptCandidate,
} from '@/lib/api'

import type { InspectorSelection } from './source-inspector-panel'

/**
 * Learning tools panel (DET-258). Visually separated from the article body and
 * always labeled "AI-assisted — not part of the source article": these are
 * comprehension scaffolds, never the source. Empty state offers a "Generate
 * learning tools" button; once generated, concept cards (label, definition,
 * source refs that open the inspector, validation chip + Validate/Dismiss) and a
 * retrieval-prompt list. The AI-assisted label is always visible.
 */
export function LearningToolsPanel({
  articleId,
  layer,
  sections,
  onInspect,
}: {
  articleId: string
  layer: LearningLayer | null
  /** Article sections (incl. subsections) for candidate grouping labels (DET-283). */
  sections?: ArticleSectionV2[]
  onInspect: (selection: InspectorSelection) => void
}) {
  const queryClient = useQueryClient()

  const generate = useMutation({
    mutationFn: () => api.generateLearningLayer(articleId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

  const validate = useMutation({
    mutationFn: (input: {
      itemId: string
      status: 'validated' | 'dismissed'
    }) => api.setLearningItemValidation(articleId, input.itemId, input.status),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

  const candidates = layer?.conceptCandidates ?? []
  const promptCandidates = layer?.retrievalPromptCandidates ?? []
  const misconceptions = layer?.misconceptions ?? []
  const hasContent =
    layer &&
    (layer.concepts.length > 0 ||
      layer.retrievalPrompts.length > 0 ||
      candidates.length > 0 ||
      promptCandidates.length > 0 ||
      misconceptions.length > 0)

  return (
    // The stable id is the target of the per-section "Candidates ready" link in
    // the article body (DET-283 feedback): it must open/scroll to this panel.
    <section id='learning-tools' className='panel tf-ai-panel'>
      <div className='tf-ai-head'>
        <span className='chip chip-ai'>AI-assisted</span>
        <h3 className='panel-h'>Learning tools</h3>
      </div>
      <p className='tf-ai-disclaimer'>
        Not part of the source article — AI-extracted study scaffolds. Validate
        what holds up; dismiss what doesn’t.
      </p>

      {generate.isError && (
        <p className='notice notice-error'>
          {generate.error instanceof ApiError
            ? generate.error.message
            : 'Could not generate learning tools.'}
        </p>
      )}

      {!hasContent ? (
        <div className='tf-ai-empty'>
          <p className='block-sub'>
            No learning tools yet. Generate concept cards and retrieval prompts
            grounded in the source blocks.
          </p>
          <button
            type='button'
            className='btn-ghost'
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Generating…' : 'Generate learning tools'}
          </button>
        </div>
      ) : (
        <>
          {layer && layer.concepts.length > 0 && (
            <div className='tf-concept-grid'>
              {layer.concepts.map((c) => (
                <div
                  key={c.id}
                  className={`tf-concept-card${c.validationStatus === 'dismissed' ? ' is-dismissed' : ''}`}
                >
                  <div className='tf-concept-top'>
                    <span className='tf-concept-label'>{c.label}</span>
                    <span
                      className={`chip ${
                        c.validationStatus === 'validated'
                          ? 'chip-cleared'
                          : c.validationStatus === 'dismissed'
                            ? 'chip-quiet'
                            : 'chip-pending'
                      }`}
                    >
                      {c.validationStatus}
                    </span>
                  </div>
                  <p className='tf-concept-def'>{c.definition}</p>
                  <div className='tf-concept-foot'>
                    <button
                      type='button'
                      className='tf-ref-btn'
                      onClick={() =>
                        onInspect({
                          kind: 'Concept',
                          transformedText: `${c.label} — ${c.definition}`,
                          sourceBlockIds: c.sourceBlockIds,
                        })
                      }
                    >
                      source refs ({c.sourceBlockIds.length})
                    </button>
                    <div className='tf-concept-actions'>
                      <button
                        type='button'
                        className='btn-ghost-xs'
                        disabled={
                          validate.isPending ||
                          c.validationStatus === 'validated'
                        }
                        onClick={() =>
                          validate.mutate({
                            itemId: c.id,
                            status: 'validated',
                          })
                        }
                      >
                        Validate
                      </button>
                      <button
                        type='button'
                        className='btn-ghost-xs'
                        disabled={
                          validate.isPending ||
                          c.validationStatus === 'dismissed'
                        }
                        onClick={() =>
                          validate.mutate({
                            itemId: c.id,
                            status: 'dismissed',
                          })
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {layer && layer.retrievalPrompts.length > 0 && (
            <div className='tf-prompts'>
              <h4 className='tf-aux-h'>Retrieval prompts</h4>
              <ul className='tf-prompt-list'>
                {layer.retrievalPrompts.map((p) => (
                  <li key={p.id} className='tf-prompt'>
                    {p.prompt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidates.length > 0 && (
            <ConceptCandidates
              candidates={candidates}
              sections={sections ?? []}
              onValidate={(itemId, status) =>
                validate.mutate({ itemId, status })
              }
              validating={validate.isPending}
              onInspect={onInspect}
            />
          )}

          {promptCandidates.length > 0 && (
            <RetrievalPromptCandidates
              prompts={promptCandidates}
              onInspect={onInspect}
            />
          )}

          {misconceptions.length > 0 && (
            <Misconceptions
              misconceptions={misconceptions}
              onInspect={onInspect}
            />
          )}
        </>
      )}
    </section>
  )
}

/**
 * AI-suggested active-recall prompts (DET-353). Each prompt shows its question, a
 * pedagogical-type + difficulty chip, and an "expected answer" source-refs button
 * that opens the inspector at the blocks whose content holds the answer. Every
 * prompt is plainly AI-suggested — none is a scheduled review card until the
 * learner validates or answers it.
 */
function RetrievalPromptCandidates({
  prompts,
  onInspect,
}: {
  prompts: RetrievalPromptCandidate[]
  onInspect: (selection: InspectorSelection) => void
}) {
  return (
    <div className='tf-prompts'>
      <h4 className='tf-aux-h'>Active recall prompts</h4>
      <ul className='tf-prompt-list'>
        {prompts.map((p) => (
          <li key={p.id} className='tf-prompt'>
            <div className='tf-prompt-q'>{p.question}</div>
            <div className='tf-prompt-meta'>
              <span className='chip chip-quiet'>
                {p.promptType.replace(/_/g, ' ')}
              </span>
              <span className='chip chip-quiet'>{p.difficulty}</span>
              <button
                type='button'
                className='tf-ref-btn'
                onClick={() =>
                  onInspect({
                    kind: 'Retrieval prompt',
                    transformedText: p.question,
                    sourceBlockIds: p.expectedAnswerSourceBlockIds,
                  })
                }
              >
                expected answer ({p.expectedAnswerSourceBlockIds.length})
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Misconception candidates (DET-353): a likely wrong belief paired with a
 * source-faithful correction. Every card carries an always-visible "AI-suggested"
 * chip; a grounded one also offers a source-refs button into the inspector, while
 * an ungrounded one is labelled "general — not from your source" so a learner can
 * tell apart what the source corrects from what is AI background.
 */
function Misconceptions({
  misconceptions,
  onInspect,
}: {
  misconceptions: MisconceptionCandidate[]
  onInspect: (selection: InspectorSelection) => void
}) {
  return (
    <div className='tf-misconceptions'>
      <h4 className='tf-aux-h'>Misconceptions to watch for</h4>
      <ul className='tf-misconception-list'>
        {misconceptions.map((m) => (
          <li key={m.id} className='tf-misconception'>
            <div className='tf-misconception-top'>
              <span className='tf-misconception-wrong'>{m.misconception}</span>
              <span className='chip chip-ai'>AI-suggested</span>
            </div>
            <p className='tf-misconception-fix'>
              <span className='tf-misconception-label'>Correction:</span>{' '}
              {m.correction}
            </p>
            <div className='tf-misconception-foot'>
              {m.sourceBlockIds.length > 0 ? (
                <button
                  type='button'
                  className='tf-ref-btn'
                  onClick={() =>
                    onInspect({
                      kind: 'Misconception',
                      transformedText: `${m.misconception} — ${m.correction}`,
                      sourceBlockIds: m.sourceBlockIds,
                    })
                  }
                >
                  source refs ({m.sourceBlockIds.length})
                </button>
              ) : (
                <span className='block-sub'>
                  general — not from your source
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Flatten sections + subsections into an id→heading map for candidate labels. */
function headingMap(sections: ArticleSectionV2[]): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (s: ArticleSectionV2) => {
    map.set(s.id, s.heading)
    for (const sub of s.subsections ?? []) walk(sub)
  }
  for (const s of sections) walk(s)
  return map
}

/**
 * Per-section concept candidates (DET-283). PROPOSALS — each carries an
 * always-visible "AI-assisted · unvalidated" badge for pending items; clicking a
 * candidate opens the source inspector with its sourceBlockIds, and an anchor
 * links back to its section (#section-id). Validate/Dismiss reuse the existing
 * learning-item PATCH flow. Candidates are grouped by their section, in section
 * order where the section is known, then any orphans.
 */
function ConceptCandidates({
  candidates,
  sections,
  onValidate,
  validating,
  onInspect,
}: {
  candidates: LearningConceptCandidate[]
  sections: ArticleSectionV2[]
  onValidate: (itemId: string, status: 'validated' | 'dismissed') => void
  validating: boolean
  onInspect: (selection: InspectorSelection) => void
}) {
  const headings = headingMap(sections)
  // Group by sectionId, preserving section order; unknown sections fall to the end.
  const order = [...headings.keys()]
  const bySection = new Map<string, LearningConceptCandidate[]>()
  for (const c of candidates) {
    const list = bySection.get(c.sectionId) ?? []
    list.push(c)
    bySection.set(c.sectionId, list)
  }
  const sortedIds = [...bySection.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (
      (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) -
      (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    )
  })

  return (
    <div className='tf-candidates'>
      <h4 className='tf-aux-h'>Concept candidates</h4>
      {sortedIds.map((sectionId) => {
        const heading = headings.get(sectionId) ?? sectionId
        return (
          <div key={sectionId} className='tf-candidate-group'>
            <a className='tf-candidate-section' href={`#${sectionId}`}>
              {heading}
            </a>
            <ul className='tf-candidate-list'>
              {(bySection.get(sectionId) ?? []).map((c) => (
                <li
                  key={c.id}
                  className={`tf-candidate${c.validationStatus === 'dismissed' ? ' is-dismissed' : ''}`}
                >
                  <div className='tf-candidate-top'>
                    <span className='tf-candidate-label'>{c.label}</span>
                    {c.validationStatus === 'pending' ? (
                      <span className='chip chip-ai'>
                        AI-assisted · unvalidated
                      </span>
                    ) : (
                      <span
                        className={`chip ${c.validationStatus === 'validated' ? 'chip-cleared' : 'chip-quiet'}`}
                      >
                        {c.validationStatus}
                      </span>
                    )}
                  </div>
                  <p className='tf-candidate-def'>{c.definition}</p>
                  <div className='tf-candidate-foot'>
                    <button
                      type='button'
                      className='tf-ref-btn'
                      onClick={() =>
                        onInspect({
                          kind: 'Concept candidate',
                          transformedText: `${c.label} — ${c.definition}`,
                          sourceBlockIds: c.sourceBlockIds,
                        })
                      }
                    >
                      source refs ({c.sourceBlockIds.length})
                    </button>
                    <div className='tf-candidate-actions'>
                      {c.conceptId ? (
                        // Validation already created the "to learn" concept —
                        // link to it in the capture inbox instead of offering
                        // Validate again (creation is one-shot, DET-283).
                        <a
                          className='tf-candidate-inbox-link'
                          href={`/inbox/${c.conceptId}`}
                        >
                          In inbox →
                        </a>
                      ) : (
                        <>
                          <button
                            type='button'
                            className='btn-ghost-xs'
                            disabled={
                              validating || c.validationStatus === 'validated'
                            }
                            onClick={() => onValidate(c.id, 'validated')}
                          >
                            Validate
                          </button>
                          <button
                            type='button'
                            className='btn-ghost-xs'
                            disabled={
                              validating || c.validationStatus === 'dismissed'
                            }
                            onClick={() => onValidate(c.id, 'dismissed')}
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
