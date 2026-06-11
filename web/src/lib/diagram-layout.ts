import type { DiagramSpec } from './api'

/**
 * Diagram layout — a PURE, deterministic geometry pass that turns a `diagramSpec`
 * (kind + nodes + edges) into placed boxes and arrows the SVG renderer draws
 * verbatim. Encoding the layout here (not in JSX) keeps it unit-testable without
 * React and keeps the renderer a thin map over the result.
 *
 * The figures live in a NARROW magazine column, so the default layout is a
 * vertical stack (top→bottom) with down-arrows between steps:
 *  - flow / tree / concept_map → vertical sequence.
 *  - cycle → vertical sequence plus a return arrow from the last step to the
 *    first (closing the loop).
 *  - compare → two side-by-side columns, no arrows (things set against each
 *    other).
 *
 * It never invents content: it only positions the labels the spec already
 * carries. An over-long spec is bounded by the schema (≤12 nodes) upstream.
 */

export interface LaidOutBox {
  x: number
  y: number
  w: number
  h: number
  label: string
}

export interface LaidOutArrow {
  x1: number
  y1: number
  x2: number
  y2: number
  /** True for the loop-closing return edge of a cycle (drawn to the side). */
  back?: boolean
}

export interface DiagramLayout {
  width: number
  height: number
  boxes: LaidOutBox[]
  arrows: LaidOutArrow[]
}

// Geometry constants (px in the SVG's own coordinate space; it scales to fit).
const NODE_W = 200
const NODE_H = 48
const V_GAP = 28 // vertical room for a down-arrow between stacked boxes
const COL_GAP = 20 // horizontal room between the two compare columns
const PAD = 12
const BACK_LANE = 22 // side lane width for a cycle's return arrow

export function layoutDiagram(spec: DiagramSpec): DiagramLayout {
  if (spec.kind === 'compare') return layoutCompare(spec)
  return layoutStack(spec, spec.kind === 'cycle')
}

/** Single vertical column of boxes with sequential down-arrows. */
function layoutStack(spec: DiagramSpec, cycle: boolean): DiagramLayout {
  const n = spec.nodes.length
  const laneOffset = cycle ? BACK_LANE : 0
  const boxes: LaidOutBox[] = spec.nodes.map((node, i) => ({
    x: PAD + laneOffset,
    y: PAD + i * (NODE_H + V_GAP),
    w: NODE_W,
    h: NODE_H,
    label: node.label,
  }))

  const arrows: LaidOutArrow[] = []
  for (let i = 0; i < n - 1; i++) {
    const from = boxes[i]
    const to = boxes[i + 1]
    arrows.push({
      x1: from.x + from.w / 2,
      y1: from.y + from.h,
      x2: to.x + to.w / 2,
      y2: to.y,
    })
  }

  // Close the loop: from the bottom of the last box, down the left lane, up to
  // the top of the first box.
  if (cycle && n > 1) {
    const first = boxes[0]
    const last = boxes[n - 1]
    arrows.push({
      x1: last.x,
      y1: last.y + last.h / 2,
      x2: first.x,
      y2: first.y + first.h / 2,
      back: true,
    })
  }

  return {
    width: PAD * 2 + laneOffset + NODE_W,
    height: PAD * 2 + n * NODE_H + Math.max(n - 1, 0) * V_GAP,
    boxes,
    arrows,
  }
}

/** Two columns, round-robin assignment, no arrows (side-by-side comparison). */
function layoutCompare(spec: DiagramSpec): DiagramLayout {
  const boxes: LaidOutBox[] = spec.nodes.map((node, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    return {
      x: PAD + col * (NODE_W + COL_GAP),
      y: PAD + row * (NODE_H + V_GAP),
      w: NODE_W,
      h: NODE_H,
      label: node.label,
    }
  })
  const rows = Math.ceil(spec.nodes.length / 2)
  const cols = spec.nodes.length > 1 ? 2 : 1
  return {
    width: PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    height: PAD * 2 + rows * NODE_H + Math.max(rows - 1, 0) * V_GAP,
    boxes,
    arrows: [],
  }
}
