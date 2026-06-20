/**
 * Reshaping-plan COMPLETENESS (DET-252 follow-up). The planner LLM tends to
 * silently drop the long tail of non-removable blocks on long sources: it cites
 * the salient blocks in sections and never mentions the rest, which are then
 * neither in any section's `sourceBlockIds` nor in `removedBlocks`. The coverage
 * gate later counts those as lost (below the 85% floor → BLOCKED), and the
 * regeneration re-plan repeats the omission because the planner has no
 * completeness contract.
 *
 * These pure helpers close that gap: find the silently-dropped blocks, apply a
 * steered corrective pass's assignments, and — as a last-resort backstop —
 * attach any still-uncovered block to the section holding its nearest
 * source-order neighbour, so coverage can never fail on silent omission alone.
 */

/** Minimal block shape (source order = array order). */
export interface CompletenessBlock {
  id: string
  removable: boolean
}

/** Minimal recursive section shape (only the fields completeness touches). */
export interface CompletenessSection {
  sourceBlockIds: string[]
  subsections?: CompletenessSection[]
}

/** Non-removable blocks neither cited by any section/subsection nor explicitly
 *  removed, returned in source order. */
export function findUncoveredBlockIds(
  sections: CompletenessSection[],
  removedBlockIds: ReadonlySet<string>,
  blocks: CompletenessBlock[],
): string[] {
  const cited = collectCitedIds(sections)
  return blocks
    .filter(
      (b) => !b.removable && !cited.has(b.id) && !removedBlockIds.has(b.id),
    )
    .map((b) => b.id)
}

/**
 * Last-resort backstop: append each still-uncovered block id to the TOP-LEVEL
 * section holding its nearest source-order neighbour (array position = source
 * order). Guarantees every passed id becomes cited, so the coverage gate can
 * never fail on silent omission. Preserves all other section fields.
 */
export function backstopUncovered<S extends CompletenessSection>(
  sections: S[],
  uncoveredIds: string[],
  blocks: CompletenessBlock[],
): S[] {
  if (uncoveredIds.length === 0) return sections
  const indexOf = new Map(blocks.map((b, i) => [b.id, i]))
  // Source positions each top-level section anchors (its own + subsections').
  const anchors = sections.map((s) =>
    [...collectCitedIds([s])]
      .map((id) => indexOf.get(id))
      .filter((i): i is number => i !== undefined),
  )
  const nextIds = sections.map((s) => [...s.sourceBlockIds])
  for (const id of uncoveredIds) {
    const idx = indexOf.get(id)
    if (idx === undefined) continue
    let best = -1
    let bestDist = Number.POSITIVE_INFINITY
    anchors.forEach((indices, si) => {
      for (const ci of indices) {
        const d = Math.abs(ci - idx)
        // Strict `<` keeps the earliest section on a tie (deterministic).
        if (d < bestDist) {
          bestDist = d
          best = si
        }
      }
    })
    if (best >= 0) nextIds[best].push(id)
  }
  return sections.map((s, i) => ({ ...s, sourceBlockIds: nextIds[i] }))
}

/** One steered-pass decision for a previously-dropped block: assign it to the
 *  section at `sectionIndex`, or drop it (`sectionIndex === null` ⇒ remove). */
export interface CorrectiveAssignment {
  blockId: string
  sectionIndex: number | null
}

/**
 * Apply the steered corrective pass's decisions. An `assign` appends the block
 * to the target section (deduped); a `remove` is honoured ONLY when the block is
 * actually removable (otherwise the decision is ignored and the block is left
 * for the backstop, never silently dropped). An out-of-range section index is
 * ignored for the same reason. Pure; preserves other section fields.
 */
export function applyCorrectiveAssignments<S extends CompletenessSection>(
  sections: S[],
  assignments: CorrectiveAssignment[],
  removableIds: ReadonlySet<string>,
): { sections: S[]; removedBlockIds: string[] } {
  const nextIds = sections.map((s) => [...s.sourceBlockIds])
  const removedBlockIds: string[] = []
  for (const a of assignments) {
    if (a.sectionIndex === null) {
      // Honour a drop only for a genuinely removable block — never let the LLM
      // discard protected/substantive content. Ignored blocks stay uncovered
      // and fall through to the backstop.
      if (removableIds.has(a.blockId)) removedBlockIds.push(a.blockId)
      continue
    }
    const target = nextIds[a.sectionIndex]
    if (!target) continue // out-of-range index → leave for the backstop
    if (!target.includes(a.blockId)) target.push(a.blockId)
  }
  return {
    sections: sections.map((s, i) => ({ ...s, sourceBlockIds: nextIds[i] })),
    removedBlockIds,
  }
}

/** All block ids cited by any section or (recursively) its subsections. */
function collectCitedIds(sections: CompletenessSection[]): Set<string> {
  const cited = new Set<string>()
  const walk = (section: CompletenessSection) => {
    for (const id of section.sourceBlockIds) cited.add(id)
    for (const sub of section.subsections ?? []) walk(sub)
  }
  for (const section of sections) walk(section)
  return cited
}
