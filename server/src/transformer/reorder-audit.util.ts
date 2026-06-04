import { toArticleV2 } from './article-compat.util'
import type {
  ArticleJsonV2,
  ArticleReorderingAudit,
  ArticleSectionV2,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Audited readability-reorder coverage (DET-275). Pure, deterministic functions
 * over a v2 article + its source blocks (in source order) + the article's
 * declared `reorderings` audit. They answer one question the LLM is never trusted
 * to answer: did the reading order DEVIATE from the source order, and is every
 * deviation RECORDED in the audit?
 *
 * THE MODEL. Each flattened article section (subsections inline after their
 * parent, reading order) gets a SOURCE ANCHOR — the minimum source position
 * (orderIndex) among the blocks it cites (section.sourceBlockIds plus every
 * block's sourceBlockIds). The reading order is the flattened section order; the
 * SOURCE order is those same sections re-sorted by their source anchor with a
 * STABLE tie-break on reading position (so sections that share an anchor keep
 * their relative reading order and are never spuriously "moved"). A section
 * MOVED when its reading-order index differs from its source-order index.
 *
 * THE AUDIT. A moved section's ANCHOR BLOCK is the source block id sitting at its
 * source anchor position. The move is COVERED when that anchor block id appears
 * as some `reorderings[].sourceBlockId` OR inside any `reorderings[]`
 * `movedWithClusterIds` (a block moved as part of a preserved claim/evidence/
 * caveat cluster). Any moved anchor not covered is UNAUDITED — the fidelity
 * checker turns that into a high-severity, blocking structural finding (an
 * unaudited reorder is opaque, so it is treated as unsafe).
 *
 * INVARIANT (DET-275). This util only makes movement TRANSPARENT. It never makes
 * an unsafe move acceptable: claim/caveat + claim/evidence separation and
 * chronology inversion stay BLOCKING in the cluster util regardless of whether a
 * move was audited. Plan decision: code does NOT re-sort LLM-planned sections
 * back to source order (riskier than blocking) — uncovered movement BLOCKS.
 *
 * NO PLAN DEPENDENCY. Movement is recomputed from the ARTICLE's own sections vs
 * source order, so the checker (which never receives the plan) can run it on the
 * stamped artifact. The reshaping-plan service uses the same util pre-generation.
 */

/** A source block as the audit consumes it (id only; array order = source order). */
export interface ReorderSourceBlock {
  id: string
}

/** One flattened article section with its derived source anchor + anchor block. */
export interface MovedSection {
  sectionId: string
  /** Reading-order index of the section (flattened). */
  readingIndex: number
  /** Source-order index of the section (stable sort by source anchor). */
  sourceIndex: number
  /** Minimum source position of the section's cited blocks. */
  sourceAnchorPos: number
  /** The source block id at `sourceAnchorPos` — the move's anchor block. */
  anchorBlockId: string
}

/** The audit result: which sections moved and which moves are unaudited. */
export interface ReorderCoverage {
  /** Every flattened section whose reading order differs from source order. */
  moved: MovedSection[]
  /** Moved sections whose anchor block is not covered by any audit entry. */
  unaudited: MovedSection[]
  /** Convenience counts for the coverage/provenance summary. */
  audited: number
}

/** A flattened section in reading order, with its source anchor pre-computed. */
interface FlatSection {
  sectionId: string
  readingIndex: number
  sourceAnchorPos: number
  anchorBlockId: string
}

/**
 * Flatten the article's sections (subsections inline after their parent) into
 * reading order, computing each section's source anchor (min source position of
 * its cited blocks) and the source block id at that position. Sections whose
 * cited blocks are ALL unknown to the source order are skipped (they cannot be
 * positioned — their traceability is the structural checker's concern).
 */
function flatten(
  article: ArticleJsonV2,
  sourcePos: ReadonlyMap<string, number>,
  blockAt: ReadonlyMap<number, string>,
): FlatSection[] {
  const flat: FlatSection[] = []
  let readingIndex = 0
  const walk = (sections: ArticleSectionV2[]) => {
    for (const s of sections) {
      const ids = new Set<string>(s.sourceBlockIds)
      for (const b of s.blocks) for (const id of b.sourceBlockIds) ids.add(id)
      let min = Number.POSITIVE_INFINITY
      for (const id of ids) {
        const pos = sourcePos.get(id)
        if (pos !== undefined && pos < min) min = pos
      }
      if (min !== Number.POSITIVE_INFINITY) {
        flat.push({
          sectionId: s.id,
          readingIndex: readingIndex++,
          sourceAnchorPos: min,
          anchorBlockId: blockAt.get(min) ?? '',
        })
      } else {
        // Section has no source-positionable block: still consumes a reading
        // slot so neighbours keep their relative order, but it cannot move.
        readingIndex++
      }
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)
  return flat
}

/**
 * Compute reorder coverage for an article (DET-275). Pure. Detects every section
 * whose reading order deviates from source order and flags the moves not covered
 * by the supplied `reorderings` audit (by anchor block id or movedWithClusterIds).
 */
export function auditReorderCoverage(
  input: SourcePreservingArticle | ArticleJsonV2,
  blocks: ReorderSourceBlock[],
  reorderings: ArticleReorderingAudit[] = [],
): ReorderCoverage {
  const article = toArticleV2(input)
  const sourcePos = new Map<string, number>()
  const blockAt = new Map<number, string>()
  blocks.forEach((b, i) => {
    sourcePos.set(b.id, i)
    blockAt.set(i, b.id)
  })

  const flat = flatten(article, sourcePos, blockAt)

  // Source order = the flattened sections re-sorted by source anchor, STABLE on
  // reading index (ties keep reading order so a shared anchor is never "moved").
  const sourceOrder = [...flat].sort(
    (a, b) =>
      a.sourceAnchorPos - b.sourceAnchorPos || a.readingIndex - b.readingIndex,
  )
  const sourceIndexOf = new Map<string, number>()
  sourceOrder.forEach((s, i) => sourceIndexOf.set(s.sectionId, i))

  // Every audited block id: explicit anchors + cluster-moved blocks.
  const auditedBlockIds = new Set<string>()
  for (const r of reorderings) {
    auditedBlockIds.add(r.sourceBlockId)
    for (const id of r.movedWithClusterIds ?? []) auditedBlockIds.add(id)
  }

  return classifyMovement(flat, sourceIndexOf, auditedBlockIds, reorderings)
}

/** A plan section as the plan-side audit consumes it (id-free; cites blocks). */
export interface PlanReorderSection {
  heading: string
  sourceBlockIds: string[]
  subsections?: PlanReorderSection[]
}

/** A reshaping plan as the plan-side audit consumes it. */
export interface PlanReorderInput {
  sections: PlanReorderSection[]
  reorderings?: ArticleReorderingAudit[]
}

/**
 * Plan-side reorder coverage (DET-275). The reshaping-plan service runs this on
 * the LLM plan BEFORE generation, so a deterministic warning can be appended for
 * any movement the plan's `reorderings[]` does not cover (the article-side checker
 * then BLOCKS on the same gap). A plan section's anchor is the min source position
 * of its cited `sourceBlockIds` (subsections flattened inline). Sections have no
 * stable id, so the section HEADING is used as the move's identifier.
 */
export function auditPlanReorderCoverage(
  plan: PlanReorderInput,
  blocks: ReorderSourceBlock[],
  reorderings: ArticleReorderingAudit[] = plan.reorderings ?? [],
): ReorderCoverage {
  const sourcePos = new Map<string, number>()
  const blockAt = new Map<number, string>()
  blocks.forEach((b, i) => {
    sourcePos.set(b.id, i)
    blockAt.set(i, b.id)
  })

  const flat: FlatSection[] = []
  let readingIndex = 0
  const walk = (sections: PlanReorderSection[]) => {
    for (const s of sections) {
      let min = Number.POSITIVE_INFINITY
      for (const id of s.sourceBlockIds) {
        const pos = sourcePos.get(id)
        if (pos !== undefined && pos < min) min = pos
      }
      if (min !== Number.POSITIVE_INFINITY) {
        flat.push({
          sectionId: s.heading,
          readingIndex: readingIndex++,
          sourceAnchorPos: min,
          anchorBlockId: blockAt.get(min) ?? '',
        })
      } else {
        readingIndex++
      }
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(plan.sections)

  const sourceOrder = [...flat].sort(
    (a, b) =>
      a.sourceAnchorPos - b.sourceAnchorPos || a.readingIndex - b.readingIndex,
  )
  const sourceIndexOf = new Map<string, number>()
  sourceOrder.forEach((s, i) => sourceIndexOf.set(s.sectionId, i))

  const auditedBlockIds = new Set<string>()
  for (const r of reorderings) {
    auditedBlockIds.add(r.sourceBlockId)
    for (const id of r.movedWithClusterIds ?? []) auditedBlockIds.add(id)
  }

  return classifyMovement(flat, sourceIndexOf, auditedBlockIds, reorderings)
}

/**
 * Shared movement classifier (article + plan). The MOVED set is the MINIMUM set
 * of sections whose removal leaves the rest already in source order — i.e. the
 * complement of the longest non-decreasing subsequence (LNDS) of source-anchor
 * positions taken in READING order. This is the minimal-edit interpretation:
 * moving one block to a new spot must NOT report every other section as "moved"
 * just because their absolute index shifted. Ties (shared anchors) are allowed in
 * the subsequence so equal anchors are never spuriously flagged.
 */
function classifyMovement(
  flat: FlatSection[],
  sourceIndexOf: ReadonlyMap<string, number>,
  auditedBlockIds: ReadonlySet<string>,
  reorderings: ArticleReorderingAudit[],
): ReorderCoverage {
  const kept = longestNonDecreasingSet(flat.map((s) => s.sourceAnchorPos))

  const moved: MovedSection[] = []
  const unaudited: MovedSection[] = []
  flat.forEach((s, i) => {
    if (kept.has(i)) return // stayed in source order
    const entry: MovedSection = {
      sectionId: s.sectionId,
      readingIndex: s.readingIndex,
      sourceIndex: sourceIndexOf.get(s.sectionId) ?? s.readingIndex,
      sourceAnchorPos: s.sourceAnchorPos,
      anchorBlockId: s.anchorBlockId,
    }
    moved.push(entry)
    if (!auditedBlockIds.has(s.anchorBlockId)) unaudited.push(entry)
  })

  return { moved, unaudited, audited: reorderings.length }
}

/**
 * Indices of a longest NON-DECREASING subsequence of `values` (O(n²), n is tiny —
 * a handful of sections). The returned set is the "kept in source order" set; its
 * complement is the minimal moved set.
 *
 * Tie-break (author-intuitive): among equal-length subsequences prefer the one
 * ending LATER in reading order (`len[i] >= len[best]` keeps the latest). This
 * makes the section that JUMPED forward — the high-anchor block read early — the
 * MOVED one, so its `sourceBlockId` is what the author records, rather than
 * flagging every later section the jump displaced.
 */
function longestNonDecreasingSet(values: number[]): Set<number> {
  const n = values.length
  if (n === 0) return new Set()
  const len = new Array<number>(n).fill(1)
  const prev = new Array<number>(n).fill(-1)
  let best = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (values[j] <= values[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1
        prev[i] = j
      }
    }
    // `>=` (not `>`) so a later index with equal length wins the tie.
    if (len[i] >= len[best]) best = i
  }
  const kept = new Set<number>()
  for (let i = best; i !== -1; i = prev[i]) kept.add(i)
  return kept
}
