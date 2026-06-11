'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  ApiError,
  api,
  type IllustrationSuggestion,
  type IllustrationType,
} from '@/lib/api'

/**
 * Shared illustration mechanisms (DET-261), extracted so both the inline
 * figure slots in the article body and the "Behind the article" management
 * grid drive the SAME render/remove/blob-fetch logic. Behavior is identical to
 * the original IllustrationPanel: high-risk confirm flow, spinner, error
 * notices, query invalidation on ['transformer-article', articleId], and the
 * authed-blob fetch keyed on generatedAt so a regenerate refetches the image.
 */

export const ILLUSTRATION_TYPE_LABEL: Record<IllustrationType, string> = {
  editorial_cover: 'Editorial cover',
  decorative_section: 'Decorative section',
  concept_metaphor: 'Concept metaphor',
  mechanism_explanation: 'Mechanism',
  source_based_diagram: 'Source-based diagram',
  process_diagram: 'Process diagram',
  comparison_visual: 'Comparison',
  data_figure: 'Data figure',
}

/**
 * The AI-assisted figure caption (DET-258). EVERY rendered illustration — in the
 * inline article slots AND the management grid — carries this, so an AI image
 * can never read as source matter: the "✦ AI illustration" chip, the "grounded
 * in N source blocks" provenance, and the (optional) suggestion caption.
 */
export function AiFigureCaption({
  sourceBlockIds,
  caption,
}: {
  sourceBlockIds: string[]
  caption?: string
}) {
  return (
    <figcaption className='tf-fig-caption'>
      <span className='tf-fig-aichip'>✦ AI illustration</span>
      <span className='tf-fig-grounded'>
        AI · grounded in {sourceBlockIds.length} source block
        {sourceBlockIds.length === 1 ? '' : 's'}
      </span>
      {caption && <span className='tf-fig-text'>“{caption}”</span>}
    </figcaption>
  )
}

/**
 * The render + remove mutations and their derived state for one suggestion.
 * `confirmHighRisk` is the local "render anyway?" gate state; callers wire it
 * into whichever confirm UI they render. Both surfaces share this so the
 * confirm flow + invalidation can never drift between them.
 */
export function useIllustrationActions(
  articleId: string,
  suggestionId: string,
) {
  const queryClient = useQueryClient()
  const [confirmHighRisk, setConfirmHighRisk] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['transformer-article', articleId],
    })

  const render = useMutation({
    mutationFn: (confirm: boolean) =>
      api.renderIllustration(articleId, suggestionId, confirm),
    onSuccess: () => {
      setConfirmHighRisk(false)
      return invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteIllustrationImage(articleId, suggestionId),
    onSuccess: () => invalidate(),
  })

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

  return {
    render,
    remove,
    renderError,
    removeError,
    confirmHighRisk,
    setConfirmHighRisk,
    busy: render.isPending || remove.isPending,
  }
}

/**
 * Renders the stored PNG for a rendered suggestion. The bytes are served from
 * an authenticated endpoint (an <img src> can't send the bearer token), so we
 * fetch the blob and build an object URL, revoking it on cleanup. Keyed on
 * generatedAt so a regenerate refetches the fresh image. `framed` adds the
 * AI-assisted accent-blue hairline frame used in the article body (DET-258).
 */
export function IllustrationThumbnail({
  articleId,
  suggestionId,
  meta,
  framed = false,
  alt = 'AI-rendered illustration',
}: {
  articleId: string
  suggestionId: string
  meta: NonNullable<IllustrationSuggestion['image']>
  framed?: boolean
  alt?: string
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
    <figure
      className={`tf-illus-figure${framed ? ' tf-illus-figure--framed' : ''}`}
    >
      {failed ? (
        <div className='tf-illus-thumb-fallback'>Could not load image.</div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className='tf-illus-thumb' src={src} alt={alt} />
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
