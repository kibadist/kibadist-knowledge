'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ApiError, api, type LearningLayer } from '@/lib/api'
import {
  type ConceptCandidateV3,
  learningLayerToReviewV3,
  type RetrievalPromptV3,
  type ReviewArticleState,
} from '@/lib/article-v3'

import { ConceptCandidatesReviewPanel } from './concept-candidates-review-panel'
import { RetrievalPromptsReviewPanel } from './retrieval-prompts-review-panel'

/**
 * The v3 article reader's learning-review surface (DET-359). Wraps the concept
 * candidates and retrieval prompts panels, owns the persistence mutations (each
 * invalidates the shared `['transformer-article', articleId]` query so the
 * refetched layer flows back down), and renders the blocked / generating /
 * empty states the article can be in.
 *
 * It derives the v3 review shape from the server `LearningLayer` via
 * `learningLayerToReviewV3`. Concept Accept/Reject reuse the existing validation
 * PATCH (validated = a user-review concept, never internalized); Edit and every
 * retrieval-prompt action use the DET-359 endpoints. "Create Living Concept
 * later" is a client-only deferral — it keeps the candidate pending on the
 * server and simply tucks it into the "later" bucket on screen.
 */
export function ArticleReviewPanels({
  articleId,
  layer,
  state,
}: {
  articleId: string
  layer: LearningLayer | null
  state: ReviewArticleState
}) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['transformer-article', articleId],
    })

  // Client-only "decide later" set: ids the reader deferred this session. The
  // server keeps them pending; we only re-bucket them on screen.
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set())

  const review = useMemo(() => learningLayerToReviewV3(layer), [layer])

  const generate = useMutation({
    mutationFn: () => api.generateLearningLayer(articleId),
    onSuccess: invalidate,
  })
  const validate = useMutation({
    mutationFn: (input: { id: string; status: 'validated' | 'dismissed' }) =>
      api.setLearningItemValidation(articleId, input.id, input.status),
    onSuccess: invalidate,
  })
  const editItem = useMutation({
    mutationFn: (input: {
      id: string
      edit: { label?: string; definition?: string }
    }) => api.editLearningItem(articleId, input.id, input.edit),
    onSuccess: invalidate,
  })
  const promptReview = useMutation({
    mutationFn: (input: {
      id: string
      patch: {
        reviewStatus?: 'suggested' | 'saved' | 'answered' | 'rejected'
        userAnswer?: string
        prompt?: string
      }
    }) => api.setRetrievalPromptReview(articleId, input.id, input.patch),
    onSuccess: invalidate,
  })

  const busy =
    validate.isPending ||
    editItem.isPending ||
    promptReview.isPending ||
    generate.isPending

  const mutationError = [validate, editItem, promptReview, generate].find(
    (m) => m.isError,
  )?.error

  // Blocked / generating / failed take over the whole surface — there is nothing
  // to review until the article is ready, and the state must be loud (DET-359).
  if (state === 'blocked') {
    return (
      <section className='panel tf-ai-panel tf-review-surface'>
        <ReviewHead />
        <p className='notice notice-error'>
          This article was held back by the fidelity check. Review is paused —
          read it against the source first; concepts and prompts stay
          unsuggested until it’s cleared.
        </p>
      </section>
    )
  }
  if (state === 'generating') {
    return (
      <section className='panel tf-ai-panel tf-review-surface'>
        <ReviewHead />
        <p className='block-sub'>
          Still generating — concept candidates and retrieval prompts will be
          available once the article is ready.
        </p>
      </section>
    )
  }
  if (state === 'failed' || state === 'unavailable') {
    return (
      <section className='panel tf-ai-panel tf-review-surface'>
        <ReviewHead />
        <p className='block-sub'>
          No review layer for this article. There’s nothing to suggest yet.
        </p>
      </section>
    )
  }

  const labelById = Object.fromEntries(
    review.conceptCandidates.map((c) => [c.id, c.label]),
  )

  // Apply the client-only deferral on top of the server-derived status.
  const candidates: ConceptCandidateV3[] = review.conceptCandidates.map((c) =>
    deferred.has(c.id) && c.status === 'pending'
      ? { ...c, status: 'deferred' }
      : c,
  )

  const hasContent =
    review.conceptCandidates.length > 0 || review.retrievalPrompts.length > 0

  return (
    <section className='panel tf-ai-panel tf-review-surface'>
      <ReviewHead />

      {mutationError && (
        <p className='notice notice-error'>
          {mutationError instanceof ApiError
            ? mutationError.message
            : 'Could not save that change. Try again.'}
        </p>
      )}

      {!hasContent ? (
        <div className='tf-ai-empty'>
          <p className='block-sub'>
            No suggestions yet. Generate source-grounded concept candidates and
            retrieval prompts to review.
          </p>
          {generate.isError && (
            <p className='notice notice-error'>
              {generate.error instanceof ApiError
                ? generate.error.message
                : 'Could not generate suggestions.'}
            </p>
          )}
          <button
            type='button'
            className='btn-ghost'
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Generating…' : 'Generate suggestions'}
          </button>
        </div>
      ) : (
        <>
          <ConceptCandidatesReviewPanel
            candidates={candidates}
            busy={busy}
            actions={{
              onAccept: (id) => validate.mutate({ id, status: 'validated' }),
              onReject: (id) => validate.mutate({ id, status: 'dismissed' }),
              onEdit: (id, edit) => editItem.mutate({ id, edit }),
              onDefer: (id) => setDeferred((prev) => new Set(prev).add(id)),
            }}
          />
          <RetrievalPromptsReviewPanel
            prompts={review.retrievalPrompts}
            conceptLabels={labelById}
            busy={busy}
            actions={{
              onAnswer: (id, answer) =>
                promptReview.mutate({
                  id,
                  patch: { reviewStatus: 'answered', userAnswer: answer },
                }),
              onSave: (id) =>
                promptReview.mutate({ id, patch: { reviewStatus: 'saved' } }),
              onReject: (id) =>
                promptReview.mutate({
                  id,
                  patch: { reviewStatus: 'rejected' },
                }),
              onEdit: (id, prompt) =>
                promptReview.mutate({ id, patch: { prompt } }),
            }}
          />
        </>
      )}
    </section>
  )
}

function ReviewHead() {
  return (
    <>
      <div className='tf-ai-head'>
        <span className='chip chip-ai'>AI-assisted</span>
        <h3 className='panel-h'>Review concepts &amp; prompts</h3>
      </div>
      <p className='tf-ai-disclaimer'>
        Suggestions from this article — not part of the source. Nothing here
        becomes permanent knowledge or a scheduled review without your explicit
        action.
      </p>
    </>
  )
}

export type { ConceptCandidateV3, RetrievalPromptV3 }
