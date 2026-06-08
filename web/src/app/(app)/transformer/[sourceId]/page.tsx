'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { SourceInspector } from '@/components/transformer/source-inspector'
import { api } from '@/lib/api'

import '../transformer.css'

/**
 * The former standalone Source pipeline view is no longer a user-facing route
 * (V1 Decision 3): the inspector now lives inside the document workspace as the
 * `/read/[id]?view=inspector` tab. A transformer source has no back-reference to
 * its inbox item, but inbox items carry their `sourceId`, so we resolve the
 * companion item client-side and forward to its workspace Inspector tab.
 *
 * Orphan sources (no inbox item — e.g. captured directly via the transformer
 * API) have nowhere to forward to, so they fall back to the inspector inline,
 * preserving the debugging surface the ticket calls for.
 */
export default function SourceDetailPage() {
  const { sourceId } = useParams<{ sourceId: string }>()
  const router = useRouter()

  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })
  const companion = inboxQuery.data?.find((it) => it.sourceId === sourceId)

  useEffect(() => {
    if (companion) {
      router.replace(`/read/${companion.id}?view=inspector`)
    }
  }, [companion, router])

  return (
    <div className='screen'>
      <Link href='/inbox' className='back-link'>
        ← Back to Sources
      </Link>

      {inboxQuery.isLoading && <p className='notice'>Loading…</p>}

      {/* Resolved to an inbox item — the effect above forwards to its workspace
          Inspector tab; this is the brief pre-redirect frame. */}
      {companion && <p className='notice'>Opening in the workspace…</p>}

      {/* Orphan source (no companion inbox item): keep the inspector reachable. */}
      {inboxQuery.isSuccess && !companion && (
        <SourceInspector sourceId={sourceId} />
      )}
    </div>
  )
}
