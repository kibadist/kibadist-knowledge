'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ApiError, api, type LearningLayerV3Review } from '@/lib/api'
import {
  articleV3ToReview,
  type ConceptCandidateV3,
  type RetrievalPromptV3,
  type ReviewArticleState,
} from '@/lib/article-learning-review'
import type { ArticleJsonV3 } from '@/lib/article-v3'

import { ConceptCandidatesReviewPanel } from './concept-candidates-review-panel'
import { RetrievalPromptsReviewPanel } from './retrieval-prompts-review-panel'

/**
 * The v3 article reader's learning-review surface (DET-359). Renders the concept
 * candidates + retrieval prompts STRAIGHT FROM the Article JSON v3 body
 * (`keyConcepts` / `retrievalPrompts`) — the same suggestions the reader sees in
 * the article — overlaid with the reader's persisted review decisions
 * (`learningLayer.v3Review`). Every action lands on the DET-359 v3-review
 * endpoints, which invalidate the shared `['transformer-article', articleId]`
 * query so the refetched overlay flows back down.
 *
 * The two acceptance invariants are structural, not cosmetic:
 *  - Accept moves a concept to a USER-REVIEW state and never internalizes it
 *    (the server writes a status only — no Concept row). "Create Living Concept
 *    later" persists a `deferred` decision; the concept is still never created.
 *  - A retrieval prompt only becomes a permanent review card downstream, gated on
 *    a user-authored answer — this surface can mark `answered`/`saved` but never
 *    schedules.
 */
export function ArticleReviewPanels({
  articleId,
  article,
  v3Review,
  state,
}: {
  articleId: string
  article: Pick<ArticleJsonV3, 'keyConcepts' | 'retrievalPrompts'>
  v3Review?: LearningLayerV3Review | null
  state: ReviewArticleState
}) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['transformer-article', articleId],
    })

  const review = useMemo(
    () => articleV3ToReview(article, v3Review),
    [article, v3Review],
  )

  const conceptReview = useMutation({
    mutationFn: (input: {
      id: string
      patch: {
        status?: 'pending' | 'accepted' | 'rejected' | 'deferred'
        label?: string
        definition?: string
      }
    }) => api.setV3ConceptReview(articleId, input.id, input.patch),
    onSuccess: invalidate,
  })
  const promptReview = useMutation({
    mutationFn: (input: {
      id: string
      patch: {
        status?: 'suggested' | 'saved' | 'answered' | 'rejected'
        userAnswer?: string
        prompt?: string
      }
    }) => api.setV3PromptReview(articleId, input.id, input.patch),
    onSuccess: invalidate,
  })

  const busy = conceptReview.isPending || promptReview.isPending

  const mutationError = [conceptReview, promptReview].find(
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

  const candidates: ConceptCandidateV3[] = review.conceptCandidates
  const prompts: RetrievalPromptV3[] = review.retrievalPrompts

  const hasContent = candidates.length > 0 || prompts.length > 0

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
            No concept candidates or retrieval prompts were suggested for this
            article. There’s nothing to review yet.
          </p>
        </div>
      ) : (
        <>
          <ConceptCandidatesReviewPanel
            candidates={candidates}
            busy={busy}
            actions={{
              onAccept: (id) =>
                conceptReview.mutate({ id, patch: { status: 'accepted' } }),
              onReject: (id) =>
                conceptReview.mutate({ id, patch: { status: 'rejected' } }),
              onEdit: (id, edit) => conceptReview.mutate({ id, patch: edit }),
              // "Create Living Concept later" — persist the deferral; the concept
              // is still never created (that stays a later, explicit step).
              onDefer: (id) =>
                conceptReview.mutate({ id, patch: { status: 'deferred' } }),
            }}
          />
          <RetrievalPromptsReviewPanel
            prompts={prompts}
            conceptLabels={labelById}
            busy={busy}
            actions={{
              onAnswer: (id, answer) =>
                promptReview.mutate({
                  id,
                  patch: { status: 'answered', userAnswer: answer },
                }),
              onSave: (id) =>
                promptReview.mutate({ id, patch: { status: 'saved' } }),
              onReject: (id) =>
                promptReview.mutate({ id, patch: { status: 'rejected' } }),
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
