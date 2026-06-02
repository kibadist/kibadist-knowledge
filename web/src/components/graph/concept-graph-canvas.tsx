'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeMarkerType,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodeDrag,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, type GraphData } from '@/lib/api'
import '@xyflow/react/dist/style.css'
import './graph.css'
import { ConceptNode, type ConceptNodeData } from './concept-node'
import { GraphInspector } from './graph-inspector'
import { layoutNodes } from './graph-layout'
import { RELATION_LABELS } from './relation-labels'

// The inspector overlays the right edge of the canvas (graph.css). When a node is
// selected we bias the recenter left by half this width so the selected node lands
// in the still-visible area rather than under the panel (DET-222). Matches the
// desktop `.graph-inspector` width.
const INSPECTOR_WIDTH = 384

// A batch of node positions queued for persistence after a drag (DET-221).
type PositionBatch = { conceptId: string; x: number; y: number }[]

// Resolve CSS theme tokens so React Flow primitives (edges, minimap) draw in the
// paper palette rather than React Flow's defaults. Read once on the client.
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

const nodeTypes: NodeTypes = {
  concept: ConceptNode as (props: NodeProps) => React.JSX.Element,
}

export function ConceptGraphCanvas({
  data,
  selectedId,
  onSelect,
}: {
  data: GraphData
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <ReactFlowProvider>
      <div className='graph-canvas'>
        <Flow data={data} selectedId={selectedId} onSelect={onSelect} />
      </div>
      {selectedId && (
        <GraphInspector conceptId={selectedId} onClose={() => onSelect(null)} />
      )}
    </ReactFlowProvider>
  )
}

function Flow({
  data,
  selectedId,
  onSelect,
}: {
  data: GraphData
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  // The confirmed-edge arrowhead colour. Uses --ink to MATCH the confirmed edge's
  // stroke (.is-confirmed in graph.css), fixing the prior faint mismatch where the
  // arrowhead read --rule while the line read --ink (DET-229).
  const confirmedArrow = useMemo(() => token('--ink', '#1a1714'), [])

  const initialNodes = useMemo<Node<ConceptNodeData>[]>(() => {
    const positions = layoutNodes(data.nodes, data.positions)
    return data.nodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 }
      return {
        id: n.id,
        type: 'concept',
        position: pos,
        data: {
          title: n.title,
          cognitiveState: n.cognitiveState,
          hasPersona: n.hasPersona,
          currentActivation: n.currentActivation,
        },
      }
    })
  }, [data.nodes, data.positions])

  const initialEdges = useMemo<Edge[]>(() => {
    return data.edges.map((e) => {
      const contradiction = e.relationKind === 'CONTRADICTION'
      const suggested = e.status === 'SUGGESTED'
      const ai = e.proposedBy === 'AI'
      const className = [
        'graph-edge',
        suggested ? 'is-suggested' : 'is-confirmed',
        ai ? 'is-ai' : '',
        contradiction ? 'is-contradiction' : '',
      ]
        .filter(Boolean)
        .join(' ')
      const marker: EdgeMarkerType = {
        type: MarkerType.ArrowClosed,
        color: contradiction
          ? token('--accent', '#8a2a1f')
          : suggested
            ? token('--rule-soft', '#c8bea8')
            : confirmedArrow,
      }
      return {
        id: e.id,
        source: e.sourceConceptId,
        target: e.targetConceptId,
        // Curated label, shared with the inspector, so an edge reads "depends on"
        // not the raw "DEPENDS_ON" enum (DET-223).
        label: e.relationKind
          ? RELATION_LABELS[e.relationKind]
          : (e.relation ?? undefined),
        className,
        animated: false,
        markerEnd: marker,
      }
    })
  }, [data.edges, confirmedArrow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Keep React Flow state in sync when the underlying graph data changes (e.g.
  // after a link is validated and the ['graph'] query refetches).
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])
  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  // --- Node-position persistence (DET-221) ---------------------------------
  // A moved node's position is queued by id (latest wins) and saved debounced so a
  // drag flush doesn't spam the API. The save is a mutation so a failure is never
  // silent: on error the batch is re-queued and a Retry affordance appears; on every
  // flush the ['graph'] cache is patched optimistically so a concurrent refetch
  // (e.g. validating a link invalidates ['graph']) can't snap the node back to its
  // pre-drag slot.
  const queryClient = useQueryClient()
  const pending = useRef(new Map<string, { x: number; y: number }>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)

  // Patch the cached graph positions so React Flow keeps the dragged coordinates
  // across any refetch that lands around the save.
  const patchCachedPositions = useCallback(
    (batch: PositionBatch) => {
      queryClient.setQueryData<GraphData>(['graph'], (old) => {
        if (!old) return old
        const byId = new Map(old.positions.map((p) => [p.conceptId, p]))
        for (const b of batch) {
          byId.set(b.conceptId, {
            conceptId: b.conceptId,
            x: b.x,
            y: b.y,
            locked: byId.get(b.conceptId)?.locked ?? false,
          })
        }
        return { ...old, positions: [...byId.values()] }
      })
    },
    [queryClient],
  )

  const { mutate: savePositions } = useMutation({
    mutationFn: (batch: PositionBatch) => api.saveGraphPositions(batch),
    onSuccess: () => setSaveFailed(false),
    onError: (_err, batch) => {
      // Re-queue so the next drag, the unmount flush, or an explicit Retry persists
      // it — the user's layout work is never silently dropped. The optimistic cache
      // patch from flush() is intentionally KEPT on failure (the pending queue is the
      // source of truth), so the node doesn't visibly snap back while a retry is due.
      // Only re-queue an id that isn't already pending: a re-drag of the same node
      // during the failed save's round-trip has the newer position, which must NOT be
      // clobbered by this stale batch (newer wins).
      for (const b of batch) {
        if (!pending.current.has(b.conceptId)) {
          pending.current.set(b.conceptId, { x: b.x, y: b.y })
        }
      }
      setSaveFailed(true)
    },
  })

  const flush = useCallback(() => {
    const batch: PositionBatch = Array.from(pending.current.entries()).map(
      ([conceptId, p]) => ({ conceptId, x: p.x, y: p.y }),
    )
    pending.current.clear()
    if (batch.length === 0) return
    patchCachedPositions(batch)
    savePositions(batch)
  }, [patchCachedPositions, savePositions])

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      const p = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      }
      pending.current.set(node.id, p)
      // Patch the cache NOW, not just at flush. The save is debounced 600ms; if a
      // ['graph'] refetch lands inside that window (e.g. creating a persona
      // invalidates ['graph']) it would otherwise overwrite the cache without this
      // drag and snap the node back to its layout slot until the flush fires. The
      // pending queue still drives the actual save (DET-221).
      patchCachedPositions([{ conceptId: node.id, x: p.x, y: p.y }])
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 600)
    },
    [flush, patchCachedPositions],
  )

  // Flush any pending positions on unmount so an in-flight debounce isn't lost.
  // Persists DIRECTLY rather than via the component mutation, whose onSuccess/onError
  // can't run once the component is gone (which would make a failed teardown-save
  // silently vanish). The cache is patched first so a remount keeps the coordinates.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      const batch: PositionBatch = Array.from(pending.current.entries()).map(
        ([conceptId, p]) => ({ conceptId, x: p.x, y: p.y }),
      )
      pending.current.clear()
      if (batch.length === 0) return
      patchCachedPositions(batch)
      void api.saveGraphPositions(batch).catch(() => {})
    }
  }, [patchCachedPositions])

  // --- Refit on inspector toggle (DET-222) ---------------------------------
  // The inspector overlays the canvas's right edge. When selection opens, recenter
  // the chosen node into the still-visible area (biased left of the panel); when it
  // closes, gently refit the whole graph into the reclaimed space. Debounced so a
  // rapid selection change doesn't jump the viewport.
  const { setCenter, fitView, getZoom } = useReactFlow()
  // Read the latest nodes WITHOUT making them an effect dependency. The recenter is
  // driven purely by selection changes; a `nodes` update mid-debounce (e.g. the
  // ['graph'] refetch that selecting a node triggers) must not clear the timer and
  // swallow a pending recenter (DET-222).
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const prevSelected = useRef<string | null>(selectedId)
  useEffect(() => {
    const prev = prevSelected.current
    prevSelected.current = selectedId
    if (prev === selectedId) return
    const handle = setTimeout(() => {
      if (selectedId) {
        const node = nodesRef.current.find((n) => n.id === selectedId)
        if (!node) return
        const zoom = getZoom()
        const w = node.measured?.width ?? 220
        const h = node.measured?.height ?? 88
        // Shift the focus point right in flow space so the node lands left of the
        // overlay panel on screen.
        const panelBias = INSPECTOR_WIDTH / 2 / zoom
        void setCenter(
          node.position.x + w / 2 + panelBias,
          node.position.y + h / 2,
          { zoom, duration: 240 },
        )
      } else {
        void fitView({ padding: 0.25, maxZoom: 0.9, duration: 240 })
      }
    }, 90)
    return () => clearTimeout(handle)
  }, [selectedId, setCenter, fitView, getZoom])

  // Reflect external selection (e.g. inspector close) into React Flow's
  // selection state.
  const nodesWithSelection = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  )

  return (
    <ReactFlow
      nodes={nodesWithSelection}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_e, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      nodeTypes={nodeTypes}
      fitView
      // Cap how far fitView zooms IN on a tiny graph (so two nodes don't fill the
      // screen) and pad the frame. minZoom lets the user zoom out on a big graph.
      fitViewOptions={{ maxZoom: 0.9, padding: 0.25 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.5}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={28}
        size={1}
        color={token('--rule-soft', '#c8bea8')}
      />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={token('--paper-2', '#ebe4d3')}
        nodeStrokeColor={token('--rule', '#2a2520')}
        maskColor='rgba(26, 23, 20, 0.08)'
      />
      {/* Non-intrusive failure affordance: if a position save fails the layout is
          re-queued and the user can retry it rather than losing the work (DET-221). */}
      {saveFailed && (
        <Panel position='bottom-center'>
          <div className='graph-save-error' role='status'>
            <span>Couldn’t save your layout.</span>
            <button
              type='button'
              className='btn-ghost-xs'
              onClick={() => flush()}
            >
              Retry
            </button>
          </div>
        </Panel>
      )}
    </ReactFlow>
  )
}
