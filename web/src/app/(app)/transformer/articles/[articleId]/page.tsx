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
 * source, and redirects into /read on the Article view, carrying any ?mode=
 * through. If the source is no longer in the reading queue (already earned), it
 * falls back to the Read home rather than 404ing.
 */
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
    const qs = new URLSearchParams({ view: 'article' })
    if (mode) qs.set('mode', mode)
    router.replace(`/read/${item.id}?${qs.toString()}`)
  }, [articleQuery.isError, sourceId, inboxQuery.data, mode, router])

  return (
    <div className='screen'>
      <p className='notice'>Opening in your reading workspace…</p>
    </div>
  )
}
