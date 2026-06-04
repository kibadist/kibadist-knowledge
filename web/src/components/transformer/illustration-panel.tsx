'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  api,
  type IllustrationPlan,
  type IllustrationSuggestion,
} from '@/lib/api'
import { fidelityRiskChip } from '@/lib/transformer-format'

import {
  ILLUSTRATION_TYPE_LABEL,
  IllustrationThumbnail,
  useIllustrationActions,
} from './illustration-shared'
import type { InspectorSelection } from './source-inspector-panel'

/**
 * Illustration management grid (DET-259 / DET-261). Since the magazine redesign,
 * the PRIMARY surface for illustrations is the inline, block-anchored slots in
 * the article body (article-view.tsx). This panel is the secondary "manage all"
 * grid that lives in the "Behind the article" drawer: it generates suggestions
 * and renders any that aren't placed inline (passed via `suggestions`). The
 * render/remove/approve logic is shared verbatim with the inline slots.
 */
export function IllustrationPanel({
  articleId,
  plan,
  suggestions,
  onInspect,
}: {
  articleId: string
  plan: IllustrationPlan | null
  /**
   * The suggestions to show here. Defaults to the whole plan; the drawer passes
   * only the unplaced ones so no suggestion renders in two places.
   */
  suggestions?: IllustrationSuggestion[]
  onInspect: (selection: InspectorSelection) => void
}) {
  const queryClient = useQueryClient()

  const generate = useMutation({
    mutationFn: () => api.generateIllustrations(articleId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

  const approve = useMutation({
    mutationFn: (input: {
      suggestionId: string
      approval: 'approved' | 'rejected'
    }) =>
      api.setIllustrationApproval(
        articleId,
        input.suggestionId,
        input.approval,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

  const hasPlan = plan && plan.suggestions.length > 0
  const shown = suggestions ?? plan?.suggestions ?? []

  return (
    <section className='panel tf-ai-panel'>
      <div className='tf-ai-head'>
        <span className='chip chip-ai'>AI-assisted</span>
        <h3 className='panel-h'>Illustrations</h3>
      </div>
      <p className='tf-ai-disclaimer'>
        Suggestions are grounded in source blocks and gated by your approval.
        Approved suggestions are placed as inline figures in the article — those
        not anchored to a section are managed here. AI imagery never reads as
        source content.
      </p>

      {generate.isError && (
        <p className='notice notice-error'>
          {generate.error instanceof ApiError
            ? generate.error.message
            : 'Could not generate suggestions.'}
        </p>
      )}

      {!hasPlan ? (
        <div className='tf-ai-empty'>
          <p className='block-sub'>
            No suggestions yet. Generate editorial illustration ideas — you stay
            in control of which (if any) to use.
          </p>
          <button
            type='button'
            className='btn-ghost'
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Suggesting…' : 'Suggest illustrations'}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className='block-sub'>
          All suggestions are placed as inline figures in the article above.
        </p>
      ) : (
        <div className='tf-illus-grid'>
          {shown.map((s) => (
            <IllustrationCard
              key={s.id}
              articleId={articleId}
              suggestion={s}
              onInspect={onInspect}
              approve={approve}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function IllustrationCard({
  articleId,
  suggestion: s,
  onInspect,
  approve,
}: {
  articleId: string
  suggestion: IllustrationSuggestion
  onInspect: (selection: InspectorSelection) => void
  approve: ReturnType<
    typeof useMutation<
      IllustrationPlan,
      Error,
      { suggestionId: string; approval: 'approved' | 'rejected' }
    >
  >
}) {
  const {
    render,
    remove,
    renderError,
    removeError,
    confirmHighRisk,
    setConfirmHighRisk,
    busy,
  } = useIllustrationActions(articleId, s.id)

  const isHighRisk = s.fidelityRisk === 'high'
  const isApproved = s.approval === 'approved'

  return (
    <div
      className={`tf-illus-card${isHighRisk ? ' is-high-risk' : ''}${isApproved ? ' is-approved' : ''}`}
    >
      <div className='tf-illus-top'>
        <span className='chip chip-info'>
          {ILLUSTRATION_TYPE_LABEL[s.illustrationType] ?? s.illustrationType}
        </span>
        <span className={`chip ${fidelityRiskChip(s.fidelityRisk)}`}>
          {s.fidelityRisk} risk
        </span>
        {s.approval === 'approved' && (
          <span className='chip chip-cleared'>approved</span>
        )}
        {s.approval === 'rejected' && (
          <span className='chip chip-quiet'>rejected</span>
        )}
      </div>

      <p className='tf-illus-purpose'>{s.purpose}</p>
      <p className='tf-illus-desc'>{s.visualDescription}</p>
      {s.caption && <p className='tf-illus-caption'>“{s.caption}”</p>}
      {isHighRisk && s.reason && <p className='tf-illus-reason'>{s.reason}</p>}

      {isApproved && (
        <div className='tf-illus-image'>
          {s.image ? (
            <IllustrationThumbnail
              articleId={articleId}
              suggestionId={s.id}
              meta={s.image}
            />
          ) : null}

          {renderError && (
            <p className='notice notice-error tf-illus-notice'>{renderError}</p>
          )}
          {removeError && (
            <p className='notice notice-error tf-illus-notice'>{removeError}</p>
          )}

          {s.image ? (
            <div className='tf-illus-img-actions'>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy}
                onClick={() => render.mutate(isHighRisk)}
              >
                {render.isPending ? (
                  <span className='tf-illus-spinning'>
                    <span className='tf-spinner' aria-hidden='true' />
                    Generating…
                  </span>
                ) : (
                  'Regenerate'
                )}
              </button>
              <button
                type='button'
                className='btn-ghost-xs danger'
                disabled={busy}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ) : isHighRisk && confirmHighRisk ? (
            <div className='tf-illus-confirm'>
              <p className='tf-illus-confirm-text'>
                This is a high-risk diagram — render anyway?
              </p>
              <div className='tf-illus-img-actions'>
                <button
                  type='button'
                  className='btn-ghost-xs danger'
                  disabled={render.isPending}
                  onClick={() => render.mutate(true)}
                >
                  {render.isPending ? (
                    <span className='tf-illus-spinning'>
                      <span className='tf-spinner' aria-hidden='true' />
                      Generating…
                    </span>
                  ) : (
                    'Render anyway'
                  )}
                </button>
                <button
                  type='button'
                  className='btn-ghost-xs'
                  disabled={render.isPending}
                  onClick={() => setConfirmHighRisk(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type='button'
              className='btn-ghost-xs'
              disabled={render.isPending}
              onClick={() =>
                isHighRisk ? setConfirmHighRisk(true) : render.mutate(false)
              }
            >
              {render.isPending ? (
                <span className='tf-illus-spinning'>
                  <span className='tf-spinner' aria-hidden='true' />
                  Generating…
                </span>
              ) : (
                'Generate image'
              )}
            </button>
          )}
        </div>
      )}

      <div className='tf-illus-foot'>
        <button
          type='button'
          className='tf-ref-btn'
          onClick={() =>
            onInspect({
              kind: 'Illustration',
              transformedText: `${s.purpose} — ${s.visualDescription}`,
              sourceBlockIds: s.sourceBlockIds,
            })
          }
        >
          source refs ({s.sourceBlockIds.length})
        </button>
        <div className='tf-illus-actions'>
          <button
            type='button'
            className='btn-ghost-xs'
            disabled={approve.isPending || s.approval === 'approved'}
            onClick={() =>
              approve.mutate({
                suggestionId: s.id,
                approval: 'approved',
              })
            }
          >
            Approve
          </button>
          <button
            type='button'
            className='btn-ghost-xs'
            disabled={approve.isPending || s.approval === 'rejected'}
            onClick={() =>
              approve.mutate({
                suggestionId: s.id,
                approval: 'rejected',
              })
            }
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
