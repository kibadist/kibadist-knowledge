'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  ApiError,
  api,
  type IllustrationPlan,
  type IllustrationSuggestion,
  type IllustrationType,
} from '@/lib/api'
import { fidelityRiskChip } from '@/lib/transformer-format'

import type { InspectorSelection } from './source-inspector-panel'

const TYPE_LABEL: Record<IllustrationType, string> = {
  editorial_cover: 'Editorial cover',
  decorative_section: 'Decorative section',
  source_based_diagram: 'Source-based diagram',
}

/**
 * Illustration suggestions panel (DET-259 / DET-261). A separate, AI-assisted
 * card: "Suggest illustrations" generates suggestion cards (type, purpose,
 * visual description, caption, fidelity-risk badge, reason, source refs,
 * Approve/Reject). Once a suggestion is approved (DET-261) it can be rendered
 * into an image; the rendered thumbnail, Regenerate, and Remove actions live
 * here too — never in the article body.
 */
export function IllustrationPanel({
  articleId,
  plan,
  onInspect,
}: {
  articleId: string
  plan: IllustrationPlan | null
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

  const hasContent = plan && plan.suggestions.length > 0

  return (
    <section className='panel tf-ai-panel'>
      <div className='tf-ai-head'>
        <span className='chip chip-ai'>AI-assisted</span>
        <h3 className='panel-h'>Illustration suggestions</h3>
      </div>
      <p className='tf-ai-disclaimer'>
        Suggestions are grounded in source blocks and gated by your approval.
        Approved suggestions can be rendered into AI images — kept here in the
        illustration layer, never in the article body.
      </p>

      {generate.isError && (
        <p className='notice notice-error'>
          {generate.error instanceof ApiError
            ? generate.error.message
            : 'Could not generate suggestions.'}
        </p>
      )}

      {!hasContent ? (
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
      ) : (
        <div className='tf-illus-grid'>
          {plan?.suggestions.map((s) => (
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
  const queryClient = useQueryClient()
  const [confirmHighRisk, setConfirmHighRisk] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['transformer-article', articleId],
    })

  const render = useMutation({
    mutationFn: (confirm: boolean) =>
      api.renderIllustration(articleId, s.id, confirm),
    onSuccess: () => {
      setConfirmHighRisk(false)
      return invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteIllustrationImage(articleId, s.id),
    onSuccess: () => invalidate(),
  })

  const isHighRisk = s.fidelityRisk === 'high'
  const isApproved = s.approval === 'approved'
  const busy = render.isPending || remove.isPending

  const renderError =
    render.error instanceof ApiError
      ? render.error.message
      : render.isError
        ? 'Could not render image.'
        : null
  const removeError =
    remove.error instanceof ApiError
      ? remove.error.message
      : remove.isError
        ? 'Could not remove image.'
        : null

  return (
    <div
      className={`tf-illus-card${isHighRisk ? ' is-high-risk' : ''}${isApproved ? ' is-approved' : ''}`}
    >
      <div className='tf-illus-top'>
        <span className='chip chip-info'>
          {TYPE_LABEL[s.illustrationType] ?? s.illustrationType}
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

/**
 * Renders the stored PNG for a rendered suggestion. The bytes are served from
 * an authenticated endpoint (an <img src> can't send the bearer token), so we
 * fetch the blob and build an object URL, revoking it on cleanup. Keyed on
 * generatedAt so a regenerate refetches the fresh image.
 */
function IllustrationThumbnail({
  articleId,
  suggestionId,
  meta,
}: {
  articleId: string
  suggestionId: string
  meta: NonNullable<IllustrationSuggestion['image']>
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let url: string | null = null
    let active = true
    setFailed(false)
    setSrc(null)

    api
      .getIllustrationImageBlob(articleId, suggestionId)
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [articleId, suggestionId, meta.generatedAt])

  return (
    <figure className='tf-illus-figure'>
      {failed ? (
        <div className='tf-illus-thumb-fallback'>Could not load image.</div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className='tf-illus-thumb'
          src={src}
          alt='AI-rendered illustration'
        />
      ) : (
        <div className='tf-illus-thumb-loading'>
          <span className='tf-spinner' aria-hidden='true' />
          Loading…
        </div>
      )}
      <figcaption className='tf-illus-meta'>
        {meta.width}×{meta.height} · {meta.model}
      </figcaption>
    </figure>
  )
}
