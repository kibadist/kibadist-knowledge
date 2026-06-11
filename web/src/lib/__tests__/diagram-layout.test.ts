import { describe, expect, it } from 'vitest'

import type { DiagramSpec } from '../api'
import { layoutDiagram } from '../diagram-layout'

function nodes(n: number): DiagramSpec['nodes'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `Step ${i}`,
  }))
}

describe('layoutDiagram', () => {
  it('stacks a flow vertically with a down-arrow between each step', () => {
    const layout = layoutDiagram({ kind: 'flow', nodes: nodes(3), edges: [] })
    expect(layout.boxes).toHaveLength(3)
    // Every box shares the same x (single column) and descends in y.
    expect(new Set(layout.boxes.map((b) => b.x)).size).toBe(1)
    expect(layout.boxes[0].y).toBeLessThan(layout.boxes[1].y)
    expect(layout.boxes[1].y).toBeLessThan(layout.boxes[2].y)
    // n-1 sequential connectors, none of them a return edge.
    expect(layout.arrows).toHaveLength(2)
    expect(layout.arrows.every((a) => !a.back)).toBe(true)
    expect(layout.boxes.map((b) => b.label)).toEqual([
      'Step 0',
      'Step 1',
      'Step 2',
    ])
  })

  it('adds a return arrow for a cycle', () => {
    const layout = layoutDiagram({ kind: 'cycle', nodes: nodes(3), edges: [] })
    expect(layout.arrows).toHaveLength(3) // 2 forward + 1 return
    expect(layout.arrows.filter((a) => a.back)).toHaveLength(1)
  })

  it('lays a comparison out in two columns with no arrows', () => {
    const layout = layoutDiagram({
      kind: 'compare',
      nodes: nodes(4),
      edges: [],
    })
    expect(layout.arrows).toHaveLength(0)
    const xs = [...new Set(layout.boxes.map((b) => b.x))].sort((a, b) => a - b)
    expect(xs).toHaveLength(2) // two distinct columns
    // First two nodes sit in the same row, different columns.
    expect(layout.boxes[0].y).toBe(layout.boxes[1].y)
    expect(layout.boxes[0].x).not.toBe(layout.boxes[1].x)
  })

  it('produces a positive, content-sized canvas', () => {
    const layout = layoutDiagram({ kind: 'flow', nodes: nodes(2), edges: [] })
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    // The canvas contains the lowest box.
    const lowest = Math.max(...layout.boxes.map((b) => b.y + b.h))
    expect(layout.height).toBeGreaterThanOrEqual(lowest)
  })
})
