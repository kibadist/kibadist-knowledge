import type { CognitiveState, GraphNode, GraphPosition } from '@/lib/api'

// Deterministic fallback layout for nodes with no saved position. Concepts are
// grouped by cognitive state into vertical columns, ordered along the mastery
// ladder, and stacked within their column. Saved positions ALWAYS win — this
// only fills in coordinates the user hasn't pinned yet. No external layout lib,
// just simple column math.

// Column order: the mastery ladder first, then the off-ladder states trailing.
const STATE_ORDER: CognitiveState[] = [
  'SEEN',
  'PARSED',
  'EXPLAINED',
  'LINKED',
  'RETRIEVED',
  'DEFENDED',
  'INTERNALIZED',
  'DORMANT',
  'CONTESTED',
  'ARCHIVED',
]

const COLUMN_WIDTH = 280
const ROW_HEIGHT = 140
const ORIGIN_X = 40
const ORIGIN_Y = 40
// A half-row vertical stagger between adjacent columns so a sparse graph (one
// node per state) reads as a gentle diagonal ribbon instead of a thin, wide
// single line that forces fitView to zoom out until nodes are unreadable.
const COLUMN_STAGGER = ROW_HEIGHT / 2

export interface XYPosition {
  x: number
  y: number
}

/**
 * Resolve a position for every node. A node with a saved position uses it
 * verbatim; otherwise it gets a deterministic slot in its cognitive-state column.
 *
 * Columns are COMPACTED: only states that actually have nodes get a column, laid
 * out left-to-right in mastery-ladder order. Empty ladder rungs leave no gap, so
 * five sparse concepts don't span the full ten-state ladder width.
 */
export function layoutNodes(
  nodes: GraphNode[],
  positions: GraphPosition[],
): Map<string, XYPosition> {
  const saved = new Map(positions.map((p) => [p.conceptId, p]))
  const result = new Map<string, XYPosition>()

  // Track how many nodes have been stacked in each column so far.
  const columnFill = new Map<CognitiveState, number>()

  // Assign each PRESENT cognitive state a compact column index in ladder order,
  // skipping states with no nodes so columns are always adjacent.
  const presentStates = [...new Set(nodes.map((n) => n.cognitiveState))].sort(
    (a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b),
  )
  const columnIndex = new Map<CognitiveState, number>(
    presentStates.map((s, i) => [s, i]),
  )

  // Iterate in a stable order (state column, then creation time) so the layout
  // is fully deterministic across renders.
  const ordered = [...nodes].sort((a, b) => {
    const ai = STATE_ORDER.indexOf(a.cognitiveState)
    const bi = STATE_ORDER.indexOf(b.cognitiveState)
    if (ai !== bi) return ai - bi
    return a.createdAt.localeCompare(b.createdAt)
  })

  for (const node of ordered) {
    const savedPos = saved.get(node.id)
    if (savedPos) {
      result.set(node.id, { x: savedPos.x, y: savedPos.y })
      // Count a saved node against its cognitive-state column so a later UNSAVED
      // node in the same column gets a fresh row below it instead of being dropped
      // on top of an un-moved saved node sharing that column (DET-229).
      columnFill.set(
        node.cognitiveState,
        (columnFill.get(node.cognitiveState) ?? 0) + 1,
      )
      continue
    }
    const col = columnIndex.get(node.cognitiveState) ?? 0
    const row = columnFill.get(node.cognitiveState) ?? 0
    columnFill.set(node.cognitiveState, row + 1)
    result.set(node.id, {
      x: ORIGIN_X + col * COLUMN_WIDTH,
      y: ORIGIN_Y + row * ROW_HEIGHT + (col % 2) * COLUMN_STAGGER,
    })
  }

  return result
}
