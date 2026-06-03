'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  api,
  type IllustrationPlan,
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
 * Illustration suggestions panel (DET-259). A separate, AI-assisted card:
 * "Suggest illustrations" generates suggestion cards (type, purpose, visual
 * description, caption, fidelity-risk badge — high risk rendered loud — reason,
 * source refs, Approve/Reject). Approved state is shown. An explicit note makes
 * clear no images are generated — these are suggestions only.
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
        No images are generated — suggestions only. Each is grounded in source
        blocks and gated by your approval.
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
            <div
              key={s.id}
              className={`tf-illus-card${s.fidelityRisk === 'high' ? ' is-high-risk' : ''}${s.approval === 'approved' ? ' is-approved' : ''}`}
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
              {s.fidelityRisk === 'high' && s.reason && (
                <p className='tf-illus-reason'>{s.reason}</p>
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
          ))}
        </div>
      )}
    </section>
  )
}
