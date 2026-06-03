'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, type LearningLayer } from '@/lib/api'

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
  onInspect,
}: {
  articleId: string
  layer: LearningLayer | null
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

  const hasContent =
    layer && (layer.concepts.length > 0 || layer.retrievalPrompts.length > 0)

  return (
    <section className='panel tf-ai-panel'>
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
        </>
      )}
    </section>
  )
}
