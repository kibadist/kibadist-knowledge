'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { ConceptGraphCanvas } from '@/components/graph/concept-graph-canvas'
import { api } from '@/lib/api'
import { COGNITIVE_STATE_LABELS } from '@/lib/labels'
import { useWorkspace } from '@/lib/workspace-context'

/**
 * Domain detail (DET-238): the domain's DOMAIN-scoped graph (DET-236) plus its
 * member concepts. A view over live data — opening a domain never changes any
 * concept; it just draws the slice that belongs to this region.
 */
export default function DomainDetailPage() {
  const params = useParams<{ id: string }>()
  const domainId = params.id
  const { activeWorkspaceId } = useWorkspace()

  // The domain itself comes from the list cache (DET-234 exposes no single GET).
  const domainsQuery = useQuery({
    queryKey: ['domains', activeWorkspaceId],
    queryFn: api.listDomains,
  })
  const domain = domainsQuery.data?.find((d) => d.id === domainId)

  const graphQuery = useQuery({
    queryKey: ['graph', 'domain', domainId],
    queryFn: () => api.getScopedGraph({ scope: 'DOMAIN', domainId }),
  })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  const nodes = graphQuery.data?.nodes ?? []
  const hasNodes = nodes.length > 0

  if (domainsQuery.isLoading) {
    return (
      <div className='screen'>
        <p className='notice'>Loading domain…</p>
      </div>
    )
  }
  if (!domain) {
    return (
      <div className='screen'>
        <div className='page-head'>
          <Link href='/domains' className='back-link'>
            ← Domains
          </Link>
          <h1>Domain not found</h1>
        </div>
        <p className='notice'>
          This domain doesn’t exist in the current workspace.
        </p>
      </div>
    )
  }

  return (
    <div className='screen'>
      <div className='page-head'>
        <Link href='/domains' className='back-link'>
          ← Domains
        </Link>
        <div className='domain-detail-title'>
          <span
            className='domain-swatch'
            style={{ background: domain.color ?? 'var(--rule-soft)' }}
            aria-hidden
          />
          <h1>{domain.name}</h1>
        </div>
        {domain.description && <p className='lede'>{domain.description}</p>}
      </div>

      <section className='track-section'>
        <h2 className='track-group-head'>Region map</h2>
        <p className='track-section-note'>
          The DOMAIN-scoped slice of your concept graph — the concepts tagged
          into this region and the links between them.
        </p>
        {graphQuery.isLoading && <p className='notice'>Loading the map…</p>}
        {!graphQuery.isLoading && !hasNodes && (
          <div className='empty'>
            No concepts in this domain yet.
            <span>
              Tag concepts into it from a concept’s page, or accept an AI domain
              suggestion there.
            </span>
          </div>
        )}
        {hasNodes && graphQuery.data && (
          <div className='track-graph-frame'>
            <ConceptGraphCanvas
              data={graphQuery.data}
              selectedId={selectedNode}
              onSelect={setSelectedNode}
            />
          </div>
        )}
      </section>

      {hasNodes && (
        <section className='track-section'>
          <h2 className='track-group-head'>Concepts in this domain</h2>
          <ul className='rows'>
            {nodes.map((node) => (
              <li key={node.id} className='domain-concept-row'>
                <Link href={`/concepts/${node.id}`}>{node.title}</Link>
                <span className='track-concept-statelabel'>
                  {COGNITIVE_STATE_LABELS[node.cognitiveState]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
