'use client'

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
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { api, type GraphData } from '@/lib/api'
import '@xyflow/react/dist/style.css'
import './graph.css'
import { ConceptNode, type ConceptNodeData } from './concept-node'
import { GraphInspector } from './graph-inspector'
import { layoutNodes } from './graph-layout'
import { GraphLegend } from './graph-legend'

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
      <div className={`graph-shell${selectedId ? '' : ' is-idle'}`}>
        <div className='graph-canvas'>
          <Flow data={data} selectedId={selectedId} onSelect={onSelect} />
          <GraphLegend />
        </div>
        {selectedId && (
          <GraphInspector
            conceptId={selectedId}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
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
  const inkSoft = useMemo(() => token('--rule', '#2a2520'), [])

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
            : inkSoft,
      }
      return {
        id: e.id,
        source: e.sourceConceptId,
        target: e.targetConceptId,
        label: e.relationKind ?? e.relation ?? undefined,
        className,
        animated: false,
        markerEnd: marker,
      }
    })
  }, [data.edges, inkSoft])

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

  // Persist a moved node's position, debounced so a drag flush doesn't spam the
  // API. Each dragged node is queued by id; the latest position wins.
  const pending = useRef(new Map<string, { x: number; y: number }>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    const batch = Array.from(pending.current.entries()).map(
      ([conceptId, p]) => ({ conceptId, x: p.x, y: p.y }),
    )
    pending.current.clear()
    if (batch.length > 0) {
      void api.saveGraphPositions(batch)
    }
  }, [])

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      pending.current.set(node.id, {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 600)
    },
    [flush],
  )

  // Flush any pending positions on unmount so an in-flight debounce isn't lost.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        flush()
      }
    }
  }, [flush])

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
    </ReactFlow>
  )
}
