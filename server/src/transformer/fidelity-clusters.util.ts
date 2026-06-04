import { toArticleV2 } from './article-compat.util'
import type { SourceStructureModel } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  FidelityFinding,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Reorder-aware CLUSTER validation (DET-281). Pure functions over the structure
 * model + classified source blocks + the v2 article. They catch meaning-altering
 * SEPARATION that traceability checks miss: a claim and the caveat that limits it
 * (or the evidence that supports it) rendered far apart, or the caveat dropped
 * entirely; plus a conservative chronology-inversion guard.
 *
 * DESIGN FOR W10. `validateClusters` accepts an optional `reorderings` array so
 * the W10 reorder audit can feed proposed moves in later; today it derives
 * everything from final article order vs source order. All thresholds are
 * documented constants and intentionally conservative — these findings BLOCK, so
 * a false positive is worse than missing a borderline case.
 *
 * LIMITS (documented on purpose):
 *  - Anchoring is by SOURCE adjacency of cited blocks, not semantic matching: a
 *    caveat is anchored to a claim only when their source blocks overlap or sit
 *    within {@link SOURCE_ADJACENCY} positions in source order.
 *  - Chronology detection is shallow: it fires only when cited source text is
 *    date/sequence-marker dense AND section anchors are heavily inverted.
 */

/** Max gap (in SOURCE order positions) for two items to count as "adjacent". */
const SOURCE_ADJACENCY = 2

/** Max gap (in reading-order SECTION index) before a cluster is "separated". */
const MAX_SECTION_GAP = 1

/** Fraction of inverted section-anchor pairs that counts as "heavy" inversion. */
const CHRONOLOGY_INVERSION_THRESHOLD = 0.5

/** Fraction of chronology-anchored sections needed to treat source as ordered. */
const CHRONOLOGY_MARKER_THRESHOLD = 0.5

/** Forward-compat input for W10 — proposed reorderings, ignored deterministically. */
export interface ClusterValidationOptions {
  reorderings?: { sourceBlockId: string }[]
}

interface ClusterContext {
  article: ArticleJsonV2
  /** Source order position (0-based) of each block id. */
  sourcePos: Map<string, number>
  /** Classification of each block id (e.g. 'EVIDENCE', 'MAIN_ARGUMENT'). */
  classOf: Map<string, string>
  /** Source text of each block id. */
  textOf: Map<string, string>
  /** Flattened reading-order section index of each block id (-1 = unrendered). */
  sectionIndexOfBlock: Map<string, number>
  /** Total number of flattened sections (reading order). */
  sectionCount: number
}

/** Build the lookup context shared by every cluster check. */
function buildContext(
  input: SourcePreservingArticle | ArticleJsonV2,
  blocks: ClassifiedBlockInput[],
): ClusterContext {
  const article = toArticleV2(input)
  const sourcePos = new Map<string, number>()
  const classOf = new Map<string, string>()
  const textOf = new Map<string, string>()
  blocks.forEach((b, i) => {
    sourcePos.set(b.id, i)
    classOf.set(b.id, b.classification)
    textOf.set(b.id, b.text)
  })

  // Flatten sections in reading order (subsections inline after their parent),
  // recording which reading-order section each source block renders into.
  const sectionIndexOfBlock = new Map<string, number>()
  let sectionCount = 0
  const walk = (sections: ArticleSectionV2[]) => {
    for (const s of sections) {
      const idx = sectionCount++
      const ids = new Set<string>(s.sourceBlockIds)
      for (const b of s.blocks) for (const id of b.sourceBlockIds) ids.add(id)
      for (const id of ids)
        if (!sectionIndexOfBlock.has(id)) sectionIndexOfBlock.set(id, idx)
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)

  return {
    article,
    sourcePos,
    classOf,
    textOf,
    sectionIndexOfBlock,
    sectionCount,
  }
}

/** The reading-order section index a set of cited blocks renders into (min), or
 *  -1 if NONE of them render anywhere in the article body. */
function renderSectionIndex(ids: string[], ctx: ClusterContext): number {
  let min = -1
  for (const id of ids) {
    const idx = ctx.sectionIndexOfBlock.get(id)
    if (idx === undefined) continue
    if (min === -1 || idx < min) min = idx
  }
  return min
}

/** True if two source-block sets overlap or sit within SOURCE_ADJACENCY. */
function sourceAdjacent(
  a: string[],
  b: string[],
  ctx: ClusterContext,
): boolean {
  const aSet = new Set(a)
  for (const id of b) if (aSet.has(id)) return true
  let best = Number.POSITIVE_INFINITY
  for (const x of a) {
    const px = ctx.sourcePos.get(x)
    if (px === undefined) continue
    for (const y of b) {
      const py = ctx.sourcePos.get(y)
      if (py === undefined) continue
      best = Math.min(best, Math.abs(px - py))
    }
  }
  return best <= SOURCE_ADJACENCY
}

/**
 * Detect claim↔caveat and claim↔evidence cluster SEPARATION (DET-281, HIGH,
 * blocks). A caveat (structure-model caveat) is anchored to a claim whose cited
 * source blocks overlap or are source-adjacent; if the claim renders in section
 * i and the anchored caveat renders in section j with |i-j| > 1, or the claim
 * renders but the caveat renders nowhere, it is a blocking separation. The same
 * test runs for EVIDENCE-classified blocks against the claims they sit adjacent
 * to in source.
 */
function detectSeparation(ctx: ClusterContextWithModel): FidelityFinding[] {
  const findings: FidelityFinding[] = []
  const model = ctx.model

  for (const caveat of model.caveats) {
    for (const claim of model.claims) {
      if (!sourceAdjacent(caveat.sourceBlockIds, claim.sourceBlockIds, ctx))
        continue
      const claimSection = renderSectionIndex(claim.sourceBlockIds, ctx)
      if (claimSection === -1) continue // claim not rendered → not this check
      const caveatSection = renderSectionIndex(caveat.sourceBlockIds, ctx)
      if (caveatSection === -1) {
        findings.push({
          severity: 'high',
          description: `Caveat "${truncate(
            caveat.text,
          )}" qualifies a rendered claim but is not rendered anywhere — meaning lost.`,
          sourceBlockIds: caveat.sourceBlockIds,
        })
        continue
      }
      if (Math.abs(claimSection - caveatSection) > MAX_SECTION_GAP)
        findings.push({
          severity: 'high',
          description: `Caveat "${truncate(
            caveat.text,
          )}" is separated from the claim it qualifies (sections ${claimSection} vs ${caveatSection}).`,
          sourceBlockIds: [...claim.sourceBlockIds, ...caveat.sourceBlockIds],
        })
    }
  }

  // EVIDENCE-classified source blocks relative to claims adjacent in source.
  const evidenceIds = [...ctx.classOf.entries()]
    .filter(([, cls]) => cls === 'EVIDENCE')
    .map(([id]) => id)
  for (const evId of evidenceIds) {
    for (const claim of model.claims) {
      if (!sourceAdjacent([evId], claim.sourceBlockIds, ctx)) continue
      const claimSection = renderSectionIndex(claim.sourceBlockIds, ctx)
      if (claimSection === -1) continue
      const evSection = renderSectionIndex([evId], ctx)
      if (evSection === -1) continue // unrendered evidence handled by coverage
      if (Math.abs(claimSection - evSection) > MAX_SECTION_GAP)
        findings.push({
          severity: 'high',
          description: `Evidence block ${evId} is separated from the claim it supports (sections ${claimSection} vs ${evSection}).`,
          sourceBlockIds: [...claim.sourceBlockIds, evId],
        })
    }
  }

  return findings
}

const DATE_MARKER_RE =
  /\b(?:\d{4}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|then|after|before|later|subsequently|first|next|finally|earlier)\b/i

/**
 * Conservative CHRONOLOGY guard (DET-281, HIGH emphasisChanges). Deterministic
 * minimal version: for each flattened section compute its source anchor (the
 * minimum source orderIndex among the blocks it cites). If MORE THAN
 * {@link CHRONOLOGY_INVERSION_THRESHOLD} of consecutive section-anchor pairs are
 * strictly DECREASING (i.e. reading order runs heavily backwards through the
 * source) AND the source carries chronology markers (date/sequence words dense
 * across cited blocks, ≥ {@link CHRONOLOGY_MARKER_THRESHOLD} of sections), flag a
 * high-severity emphasis change. Limited by design: it cannot tell a deliberate
 * thematic reorder from a chronological one, hence the marker gate.
 */
function detectChronologyInversion(ctx: ClusterContext): FidelityFinding[] {
  // Per flattened section: min source position of its cited blocks, and whether
  // its cited source text is chronology-marker dense.
  const anchors: number[] = []
  const markered: boolean[] = []
  let sectionIdx = 0
  const visit = (sections: ArticleSectionV2[]) => {
    for (const s of sections) {
      const ids = new Set<string>(s.sourceBlockIds)
      for (const b of s.blocks) for (const id of b.sourceBlockIds) ids.add(id)
      let min = Number.POSITIVE_INFINITY
      let hasMarker = false
      for (const id of ids) {
        const pos = ctx.sourcePos.get(id)
        if (pos !== undefined) min = Math.min(min, pos)
        const text = ctx.textOf.get(id)
        if (text && DATE_MARKER_RE.test(text)) hasMarker = true
      }
      if (min !== Number.POSITIVE_INFINITY) {
        anchors[sectionIdx] = min
        markered[sectionIdx] = hasMarker
      }
      sectionIdx++
      if (s.subsections) visit(s.subsections)
    }
  }
  visit(ctx.article.sections)

  const pairs = anchors.length - 1
  if (pairs < 1) return []

  let inverted = 0
  for (let i = 0; i < anchors.length - 1; i++)
    if (anchors[i] !== undefined && anchors[i + 1] !== undefined)
      if (anchors[i + 1] < anchors[i]) inverted++

  const markerFraction =
    markered.filter(Boolean).length / Math.max(1, anchors.length)

  if (
    inverted / pairs > CHRONOLOGY_INVERSION_THRESHOLD &&
    markerFraction >= CHRONOLOGY_MARKER_THRESHOLD
  )
    return [
      {
        severity: 'high',
        description: `Reading order heavily inverts a chronologically-ordered source (${inverted}/${pairs} section transitions run backwards) — emphasis/sequence may be misrepresented.`,
      },
    ]
  return []
}

/** Trim a description preview. */
function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

interface ClusterContextWithModel extends ClusterContext {
  model: SourceStructureModel
}

/**
 * Validate the article against the structure model's claim/caveat clusters and
 * evidence adjacency (DET-281). Returns `structuralFindings` (claim/caveat and
 * claim/evidence SEPARATION — high, blocking) and `emphasisChanges` (chronology
 * inversion — high). Pure; callers merge these into the fidelity report and
 * recompute `approved` in code.
 */
export function validateClusters(
  input: SourcePreservingArticle | ArticleJsonV2,
  structureModel: SourceStructureModel,
  blocks: ClassifiedBlockInput[],
  _options: ClusterValidationOptions = {},
): {
  structuralFindings: FidelityFinding[]
  emphasisChanges: FidelityFinding[]
} {
  const base = buildContext(input, blocks)
  const ctx: ClusterContextWithModel = { ...base, model: structureModel }
  return {
    structuralFindings: detectSeparation(ctx),
    emphasisChanges: detectChronologyInversion(ctx),
  }
}
