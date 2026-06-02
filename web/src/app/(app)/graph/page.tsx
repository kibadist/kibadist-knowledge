'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ConceptGraphCanvas } from '@/components/graph/concept-graph-canvas'
import { GraphLegend } from '@/components/graph/graph-legend'
import { api } from '@/lib/api'

/**
 * The Map — a full-bleed, Figma-style spatial view of the earned-concept graph.
 * The canvas fills the whole workspace; the title, legend and inspector float
 * over it as fixed HUD panels so panning has maximum room. Concepts are paper
 * cards, connections are edges (dashed = an AI/Connector suggestion awaiting
 * validation, solid = confirmed, accent = a contradiction). Captured ≠
 * knowledge — everything here was earned.
 */
export default function GraphPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const graphQuery = useQuery({
    queryKey: ['graph'],
    queryFn: api.getGraph,
  })

  const data = graphQuery.data
  const hasNodes = !!data && data.nodes.length > 0

  return (
    <div className='graph-page'>
      {/* Floating HUD, top-left: title + (when populated) the collapsible legend.
          The container ignores pointer events so the canvas stays draggable in
          the gaps; each panel re-enables them for itself. */}
      <div className='graph-hud graph-hud-left'>
        <header className='graph-titlecard'>
          <span className='section-label'>§ Map · Overview</span>
          <h1 className='graph-title'>The Map</h1>
          <p className='graph-subtle'>
            Drag to arrange — your layout persists. Dashed edges are suggestions
            awaiting your validation; solid ones you’ve earned.
          </p>
        </header>
        {hasNodes && <GraphLegend />}
      </div>

      {graphQuery.isLoading && (
        <div className='graph-overlay'>
          <p className='notice'>Loading the map…</p>
        </div>
      )}
      {graphQuery.isError && (
        <div className='graph-overlay'>
          <p className='notice notice-error'>Could not load the map.</p>
        </div>
      )}

      {data && data.nodes.length === 0 && (
        <div className='graph-overlay'>
          <div className='empty'>
            The map is empty.
            <span>
              Compress something from your inbox to place your first concept.
            </span>
          </div>
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
