'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ConceptGraphCanvas } from '@/components/graph/concept-graph-canvas'
import { api } from '@/lib/api'

/**
 * The Map — a spatial view of the earned-concept graph. Concepts are paper
 * cards, connections are edges (dashed = an AI/Connector suggestion awaiting
 * validation, solid = a confirmed, earned connection, accent = a contradiction).
 * Selecting a concept opens the inspector to validate connections and read its
 * AI persona scaffold. Captured ≠ knowledge — everything here was earned.
 */
export default function GraphPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const graphQuery = useQuery({
    queryKey: ['graph'],
    queryFn: api.getGraph,
  })

  const data = graphQuery.data

  return (
    <div className='screen graph-screen'>
      <div className='page-head'>
        <div className='section-label'>§ Map · Overview</div>
        <h1>The Map</h1>
        <p className='lede'>
          Your concepts in space, and how they connect. Drag to arrange; the
          layout is yours to keep. Dashed edges are suggestions awaiting your
          validation — solid ones you’ve earned.
        </p>
      </div>

      {graphQuery.isLoading && <p className='notice'>Loading the map…</p>}
      {graphQuery.isError && (
        <p className='notice notice-error'>Could not load the map.</p>
      )}

      {data && data.nodes.length === 0 && (
        <div className='empty'>
          The map is empty.
          <span>
            Compress something from your inbox to place your first concept.
          </span>
        </div>
      )}

      {data && data.nodes.length > 0 && (
        <ConceptGraphCanvas
          data={data}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
    </div>
  )
}
