'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ConceptGraphCanvas } from '@/components/graph/concept-graph-canvas'
import { GraphLegend } from '@/components/graph/graph-legend'
import { api, type GraphScope, type GraphView } from '@/lib/api'

// The scopes the user can switch between on the map (DET-239). MISCONCEPTION /
// REVIEW are out of MVP scope; CONCEPT_NEIGHBORHOOD is entered by focusing a node,
// not from this list.
const SELECTABLE_SCOPES: { value: GraphScope; label: string }[] = [
  { value: 'WORKSPACE', label: 'Workspace' },
  { value: 'TRACK', label: 'Track' },
  { value: 'DOMAIN', label: 'Domain' },
]

interface ScopeState {
  scope: GraphScope
  trackId?: string
  domainId?: string
  centerConceptId?: string
  centerTitle?: string
  hops: number
}

const WORKSPACE_SCOPE: ScopeState = { scope: 'WORKSPACE', hops: 1 }

/**
 * The Map (DET-230) + scope selector (DET-239). The canvas is unchanged — it just
 * receives whichever live `Concept`/`Link` subset the current scope resolves to
 * (DET-236). Switching scope never mutates concepts, links, or positions; the
 * hand-placed layout is server-persisted per concept, so it survives scope
 * changes. The PRD's most-used mode, Concept Neighborhood, is reached by focusing
 * a selected node.
 */
export default function GraphPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scopeState, setScopeState] = useState<ScopeState>(WORKSPACE_SCOPE)
  const queryClient = useQueryClient()

  // Keep the WORKSPACE view on the bare ['graph'] key so the canvas's optimistic
  // position-save (which patches ['graph']) updates the default map in place.
  // Scoped views get their own key and refetch live (positions come from the
  // server, so a dragged node's coordinate survives the scope switch).
  const queryKey =
    scopeState.scope === 'WORKSPACE'
      ? (['graph'] as const)
      : ([
          'graph',
          scopeState.scope,
          scopeState.trackId ??
            scopeState.domainId ??
            scopeState.centerConceptId ??
            '',
          scopeState.hops,
        ] as const)

  const graphQuery = useQuery({
    queryKey,
    queryFn: () =>
      api.getScopedGraph({
        scope: scopeState.scope,
        trackId: scopeState.trackId,
        domainId: scopeState.domainId,
        centerConceptId: scopeState.centerConceptId,
        hops: scopeState.hops,
      }),
  })

  const data = graphQuery.data
  const hasNodes = !!data && data.nodes.length > 0
  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.id === selectedId) ?? null,
    [data, selectedId],
  )
  const isScoped = scopeState.scope !== 'WORKSPACE'

  const focusNeighborhood = () => {
    if (!selectedNode) return
    setScopeState({
      scope: 'CONCEPT_NEIGHBORHOOD',
      centerConceptId: selectedNode.id,
      centerTitle: selectedNode.title,
      hops: 1,
    })
  }

  const applyView = (view: GraphView) => {
    setScopeState({
      scope: view.scope,
      trackId: view.trackId ?? undefined,
      domainId: view.domainId ?? undefined,
      centerConceptId: view.centerConceptId ?? undefined,
      hops: 1,
    })
  }

  return (
    <div className='graph-page'>
      <div className='graph-hud graph-hud-left'>
        <header className='graph-titlecard'>
          <span className='section-label'>§ Map · Overview</span>
          <h1 className='graph-title'>The Map</h1>
          <p className='graph-subtle'>
            Drag to arrange — your layout persists across every view. Dashed
            edges are suggestions awaiting validation; solid ones you’ve earned.
          </p>
        </header>

        <ScopeControl
          scopeState={scopeState}
          onScopeState={setScopeState}
          selectedNode={selectedNode}
          onFocusNeighborhood={focusNeighborhood}
          onApplyView={applyView}
        />

        {hasNodes && <GraphLegend />}
      </div>

      {graphQuery.isLoading && (
        <div className='graph-overlay'>
          <p className='notice'>Loading the map…</p>
        </div>
      )}
      {graphQuery.isError && (
        <div className='graph-overlay'>
          <p className='notice notice-error'>Could not load this view.</p>
        </div>
      )}

      {data && data.nodes.length === 0 && (
        <div className='graph-overlay'>
          <div className='empty'>
            {isScoped ? 'Nothing in this view.' : 'The map is empty.'}
            <span>
              {isScoped
                ? 'Try a different scope, or add concepts to it.'
                : 'Compress something from your inbox to place your first concept.'}
            </span>
          </div>
        </div>
      )}

      {data && data.nodes.length > 0 && (
        <ConceptGraphCanvas
          data={data}
          selectedId={selectedId}
          onSelect={setSelectedId}
          // Re-key the canvas per scope so layout/fit recompute cleanly when the
          // rendered subset changes.
          key={queryKey.join(':')}
        />
      )}

      {/* Floating, bottom-left: a quick "save this view" for non-workspace scopes. */}
      {isScoped && (
        <div className='graph-hud graph-hud-saveview'>
          <SaveViewControl
            scopeState={scopeState}
            onSaved={() =>
              queryClient.invalidateQueries({ queryKey: ['graph-views'] })
            }
          />
        </div>
      )}
    </div>
  )
}

/** The scope switcher: workspace/track/domain, plus neighborhood focus + recall. */
function ScopeControl({
  scopeState,
  onScopeState,
  selectedNode,
  onFocusNeighborhood,
  onApplyView,
}: {
  scopeState: ScopeState
  onScopeState: (s: ScopeState) => void
  selectedNode: { id: string; title: string } | null
  onFocusNeighborhood: () => void
  onApplyView: (view: GraphView) => void
}) {
  const tracksQuery = useQuery({
    queryKey: ['tracks'],
    queryFn: () => api.listTracks(),
  })
  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: api.listDomains,
  })
  const viewsQuery = useQuery({
    queryKey: ['graph-views'],
    queryFn: api.listGraphViews,
  })

  const { scope } = scopeState
  const neighborhood = scope === 'CONCEPT_NEIGHBORHOOD'

  return (
    <div className='graph-scope'>
      <div className='graph-scope-row'>
        {SELECTABLE_SCOPES.map((s) => (
          <button
            key={s.value}
            type='button'
            className={`graph-scope-btn${
              scope === s.value ? ' is-active' : ''
            }`}
            onClick={() =>
              onScopeState(
                s.value === 'WORKSPACE'
                  ? WORKSPACE_SCOPE
                  : { scope: s.value, hops: 1 },
              )
            }
          >
            {s.label}
          </button>
        ))}
        {neighborhood && (
          <span className='graph-scope-btn is-active'>Neighborhood</span>
        )}
      </div>

      {scope === 'TRACK' && (
        <select
          className='fld fld-sm'
          value={scopeState.trackId ?? ''}
          onChange={(e) =>
            onScopeState({ scope: 'TRACK', trackId: e.target.value, hops: 1 })
          }
        >
          <option value=''>Choose a track…</option>
          {(tracksQuery.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {scope === 'DOMAIN' && (
        <select
          className='fld fld-sm'
          value={scopeState.domainId ?? ''}
          onChange={(e) =>
            onScopeState({ scope: 'DOMAIN', domainId: e.target.value, hops: 1 })
          }
        >
          <option value=''>Choose a domain…</option>
          {(domainsQuery.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}

      {neighborhood && (
        <div className='graph-scope-neighborhood'>
          <span className='graph-scope-center'>
            Around “{scopeState.centerTitle}”
          </span>
          <div className='graph-scope-hops'>
            {[1, 2].map((h) => (
              <button
                key={h}
                type='button'
                className={`graph-scope-hopbtn${
                  scopeState.hops === h ? ' is-active' : ''
                }`}
                onClick={() => onScopeState({ ...scopeState, hops: h })}
              >
                {h} hop{h > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Focus-neighborhood offer: shown whenever a node is selected. */}
      {selectedNode && !neighborhood && (
        <button
          type='button'
          className='graph-scope-focus'
          onClick={onFocusNeighborhood}
        >
          Focus neighborhood of “{selectedNode.title}”
        </button>
      )}

      {scope !== 'WORKSPACE' && (
        <button
          type='button'
          className='graph-scope-back'
          onClick={() => onScopeState(WORKSPACE_SCOPE)}
        >
          ← Back to workspace
        </button>
      )}

      {(viewsQuery.data?.length ?? 0) > 0 && (
        <select
          className='fld fld-sm'
          value=''
          onChange={(e) => {
            const view = viewsQuery.data?.find((v) => v.id === e.target.value)
            if (view) onApplyView(view)
          }}
        >
          <option value=''>Saved views…</option>
          {viewsQuery.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/** "Save this scope as a named view" (DET-236 GraphView). */
function SaveViewControl({
  scopeState,
  onSaved,
}: {
  scopeState: ScopeState
  onSaved: () => void
}) {
  const save = useMutation({
    mutationFn: (name: string) =>
      api.createGraphView({
        name,
        scope: scopeState.scope,
        trackId: scopeState.trackId,
        domainId: scopeState.domainId,
        centerConceptId: scopeState.centerConceptId,
      }),
    onSuccess: onSaved,
  })

  // A scoped view is only savable once its target is chosen.
  const ready =
    (scopeState.scope === 'TRACK' && scopeState.trackId) ||
    (scopeState.scope === 'DOMAIN' && scopeState.domainId) ||
    (scopeState.scope === 'CONCEPT_NEIGHBORHOOD' && scopeState.centerConceptId)
  if (!ready) return null

  return (
    <button
      type='button'
      className='graph-scope-save'
      disabled={save.isPending}
      onClick={() => {
        const name = window.prompt('Name this view')
        if (name?.trim()) save.mutate(name.trim())
      }}
    >
      {save.isPending ? 'Saving…' : '★ Save this view'}
    </button>
  )
}
