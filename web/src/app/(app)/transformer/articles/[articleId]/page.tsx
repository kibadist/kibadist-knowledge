'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { api } from '@/lib/api'

/**
 * Legacy article route (DET-313). The standalone article view is gone — its
 * reading surface now lives in the unified /read/[id] document workspace
 * (DET-312). This route preserves old links / bookmarks / deep-links: it resolves
 * the article back to its companion source, finds the inbox item that owns that
 * source, and redirects into /read carrying any ?mode= through — onto the Article
 * tab for a read mode (overview/deep) and the Exercise tab for a recall/keep mode
 * (predict/rewrite/compare/extract/review), matching the /read tab split. If the
 * source is no longer in the reading queue (already earned), it falls back to the
 * Read home rather than 404ing.
 */
// Read-stage modes open the Article tab; everything else opens Exercise.
const READ_MODES = new Set(['overview', 'deep'])
export default function LegacyArticleRedirect() {
  const { articleId } = useParams<{ articleId: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const mode = params.get('mode')

  const articleQuery = useQuery({
    queryKey: ['transformer-article', articleId],
    queryFn: () => api.getTransformedArticle(articleId),
  })
  const sourceId = articleQuery.data?.sourceId ?? null

  const inboxQuery = useQuery({
    queryKey: ['inbox'],
    queryFn: api.listInbox,
    enabled: Boolean(sourceId),
  })

  useEffect(() => {
    if (articleQuery.isError) {
      router.replace('/inbox')
      return
    }
    if (!sourceId || !inboxQuery.data) return
    const item = inboxQuery.data.find((i) => i.sourceId === sourceId)
    if (!item) {
      router.replace('/inbox')
      return
    }
    const view = mode && !READ_MODES.has(mode) ? 'exercise' : 'article'
    const qs = new URLSearchParams({ view })
    if (mode) qs.set('mode', mode)
    router.replace(`/read/${item.id}?${qs.toString()}`)
  }, [articleQuery.isError, sourceId, inboxQuery.data, mode, router])

  return (
    <div className='screen'>
      <p className='notice'>Opening in your reading workspace…</p>
    </div>
  )
}
