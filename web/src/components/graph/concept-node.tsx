import { Handle, type NodeProps, Position } from '@xyflow/react'

import type { CognitiveState } from '@/lib/api'
import { COGNITIVE_STATE_LABELS } from '@/lib/labels'

// The data a concept node carries on the canvas. Mirrors the GraphNode signals
// the map needs to render calm, state-aware paper cards.
export interface ConceptNodeData {
  title: string
  cognitiveState: CognitiveState
  hasPersona: boolean
  currentActivation: number
  [key: string]: unknown
}

// Map a cognitive state to a chip variant + human label. Retained depths read as
// "cleared" (olive); CONTESTED is the one hot signal (accent); DORMANT is muted
// pending (ochre). Everything else stays quiet — no bright fills. The label is
// always the humanized form from the single labels module (DET-304) — the node
// chip must never echo the raw SHOUTING enum the way the inspector doesn't.
function stateChip(state: CognitiveState): {
  className: string
  label: string
} {
  const label = COGNITIVE_STATE_LABELS[state]
  switch (state) {
    case 'INTERNALIZED':
    case 'DEFENDED':
    case 'RETRIEVED':
      return { className: 'chip-cleared', label }
    case 'CONTESTED':
      return { className: 'chip-contested', label }
    case 'DORMANT':
      return { className: 'chip-pending', label }
    default:
      return { className: 'chip-quiet', label }
  }
}

/**
 * A single concept rendered as a paper card on the map. Calm by design: a hard
 * border, a state chip, an optional LIVING (AI scaffold) chip, and dimming for
 * faded or dormant concepts. Selection raises an accent border.
 */
export function ConceptNode({ data, selected }: NodeProps) {
  const node = data as ConceptNodeData
  const chip = stateChip(node.cognitiveState)
  // Memory decay: a faded concept (activation below the floor), a DORMANT one, or
  // an ARCHIVED (retired) one is dimmed so attention falls on what's alive. For a
  // tool whose point is "show what's alive," retired knowledge must not sit at full
  // prominence next to live concepts (DET-224).
  const faded =
    node.cognitiveState === 'DORMANT' ||
    node.cognitiveState === 'ARCHIVED' ||
    node.currentActivation < 0.5

  return (
    <div
      className={`concept-node${selected ? ' is-selected' : ''}${faded ? ' is-faded' : ''}`}
    >
      <Handle type='target' position={Position.Left} />
      <div className='concept-node-chips'>
        <span className={`chip ${chip.className}`}>{chip.label}</span>
        {node.hasPersona && <span className='chip chip-ai'>Living</span>}
      </div>
      <div className='concept-node-title'>{node.title}</div>
      <Handle type='source' position={Position.Right} />
    </div>
  )
}
