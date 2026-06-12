/**
 * Pure helpers for conceptual segmentation (DET-347). NO network, NO LLM — these
 * are the deterministic code guards the segmentation service runs AFTER the LLM:
 *  - traceability: every cited block id must exist in the source;
 *  - ordering: segments are sorted into source-reading order so the teaching arc
 *    is preserved (a later outline stage owns any audited reorder);
 *  - coverage: no HIGH-IMPORTANCE block may be left out of every segment without
 *    a recorded reason — the acceptance bar for DET-347.
 *
 * The repair (`repairSegmentation`) is the segmentation sibling of the structure
 * model / reshaping plan repairs in `traceability-repair.util.ts`: it can only
 * DELETE invented provenance, never fabricate it, so every surviving reference
 * stays 100% traceable.
 */

import type { ClassifiedBlockInput } from './structure-model.service'
import type { ConceptualSegmentation, SourceSegment } from './transformer.types'

/**
 * Block classifications that carry real teaching substance. A non-removable block
 * in one of these classes is "high importance": it MUST be placed in a segment or
 * recorded in `unsegmentedBlocks` with a reason. The lower-signal classes
 * (BACKGROUND/SIDEBAR/CITATION/UNCERTAIN and the noise classes) may be omitted
 * silently — they are not the teaching arc the segmentation must preserve.
 */
export const HIGH_IMPORTANCE_CLASSES: ReadonlySet<string> = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EXAMPLE',
  'EVIDENCE',
  'METHOD',
])

/** A block carries teaching substance the segmentation must not silently drop. */
export function isHighImportanceBlock(block: ClassifiedBlockInput): boolean {
  return !block.removable && HIGH_IMPORTANCE_CLASSES.has(block.classification)
}

/** The set of block ids any segment cites (the segment→block mapping, flattened). */
export function coveredBlockIds(
  segmentation: Pick<ConceptualSegmentation, 'segments'>,
): Set<string> {
  const ids = new Set<string>()
  for (const seg of segmentation.segments) {
    for (const id of seg.sourceBlockIds) ids.add(id)
  }
  return ids
}

/** Every cited block id (segments + unsegmentedBlocks) the source can't back. */
export function findUnknownSegmentBlockIds(
  segmentation: ConceptualSegmentation,
  known: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>()
  for (const seg of segmentation.segments) {
    for (const id of seg.sourceBlockIds) if (!known.has(id)) unknown.add(id)
  }
  for (const u of segmentation.unsegmentedBlocks) {
    if (!known.has(u.blockId)) unknown.add(u.blockId)
  }
  return [...unknown]
}

/**
 * High-importance blocks left out of every segment AND without an explicit
 * `unsegmentedBlocks` reason — the DET-347 acceptance check. An empty result
 * means coverage is complete; a non-empty result is a violation the service
 * resolves (by synthesizing a reason + warning) so the persisted artifact never
 * carries one.
 */
export function findUnreasonedHighImportanceBlocks(
  blocks: ClassifiedBlockInput[],
  segmentation: ConceptualSegmentation,
): string[] {
  const covered = coveredBlockIds(segmentation)
  const reasoned = new Set(segmentation.unsegmentedBlocks.map((u) => u.blockId))
  return blocks
    .filter(
      (b) =>
        isHighImportanceBlock(b) && !covered.has(b.id) && !reasoned.has(b.id),
    )
    .map((b) => b.id)
}

/**
 * Sort segments into source-reading order by their EARLIEST cited block, so the
 * teaching arc matches the source order (DET-347: "preserve the original ordering
 * unless a later outline stage explicitly records a reorder"). Stable for ties.
 * Segments whose blocks are all unknown sort last (they sink to the end), but the
 * service prunes those before this runs.
 */
export function orderSegmentsBySource(
  segments: SourceSegment[],
  blocks: ClassifiedBlockInput[],
): SourceSegment[] {
  const orderOf = new Map(blocks.map((b, i) => [b.id, i]))
  const earliest = (seg: SourceSegment): number => {
    let min = Number.POSITIVE_INFINITY
    for (const id of seg.sourceBlockIds) {
      const idx = orderOf.get(id)
      if (idx != null && idx < min) min = idx
    }
    return min
  }
  // Decorate-sort-undecorate keeps the sort stable across runtimes.
  return segments
    .map((seg, i) => ({ seg, key: earliest(seg), i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.seg)
}

/** True for a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep only the ids present in the source. Non-array / non-string ⇒ dropped. */
function knownIds(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (id): id is string => typeof id === 'string' && known.has(id),
  )
}

/**
 * Drop untraceable references from a raw segmentation BEFORE zod validation
 * (DET-347), via `completeJson`'s `repair` hook. Each segment keeps only its real
 * cited ids; a segment left with NO valid reference is dropped entirely (its only
 * provenance was invented, so it was never trustworthy). `unsegmentedBlocks`
 * entries about an invented block are dropped (a decision about a nonexistent
 * block is meaningless). Pure + deterministic; can only delete, never fabricate.
 *
 * If every segment is dropped the schema's `segments.min(1)` then fails the stage,
 * which is the correct loud outcome — nothing traceable was left to segment.
 */
export function repairSegmentation(
  parsed: unknown,
  known: ReadonlySet<string>,
): unknown {
  if (!isRecord(parsed)) return parsed
  const out: Record<string, unknown> = { ...parsed }

  if (Array.isArray(out.segments)) {
    out.segments = out.segments
      .map((seg) => {
        if (!isRecord(seg)) return seg
        const ids = knownIds(seg.sourceBlockIds, known)
        if (ids.length === 0) return null
        return { ...seg, sourceBlockIds: ids }
      })
      .filter((seg) => seg !== null)
  }

  if (Array.isArray(out.unsegmentedBlocks)) {
    out.unsegmentedBlocks = out.unsegmentedBlocks.filter(
      (u) =>
        isRecord(u) && typeof u.blockId === 'string' && known.has(u.blockId),
    )
  }

  return out
}
