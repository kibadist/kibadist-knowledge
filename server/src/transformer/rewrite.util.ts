/**
 * Pure post-processing for the source-grounded rewrite stage (DET-349).
 *
 * The rewrite MODEL is untrusted: it may cite block ids the segment never
 * contained, invent an analogy the source never made, or omit a confidence. The
 * SERVICE asks for a lenient reply (`RewriteSectionLlm`) and these pure helpers do
 * the strict, deterministic work that the acceptance criteria turn on:
 *
 *  - Prune every paragraph/callout/table `sourceBlockIds` to the segment's real
 *    block universe; an item left with NO surviving id is DROPPED (unsupported
 *    claims are omitted before fidelity review — AC "Unsupported claims are marked
 *    or omitted").
 *  - Drop any callout the model flagged `grounded: false` (AI-invented), and drop a
 *    `source_analogy` callout unless one of its surviving blocks actually has the
 *    `analogy` role — so a source-provided analogy can become a callout, but an
 *    AI-invented analogy is never produced in default mode.
 *  - Normalize the `SourceTrace`: clamp `confidence` to [0,1] and FLOOR the
 *    fidelity risk for the riskier transforms (`source_grounded_inference` ≥ medium;
 *    `ai_assisted_scaffold` = high) so a model can't under-state risk.
 *  - Mint deterministic anchor ids and compute each section's `sourceBlockIds` as
 *    the union of its content's provenance.
 *
 * Everything here is pure + deterministic, so the rewrite output is snapshot-stable
 * and testable without the network.
 */

import type {
  LlmCallout,
  LlmParagraph,
  LlmTable,
  RewriteSectionLlm,
} from './rewrite.schemas'
import type {
  ArticleCalloutV3,
  ArticleParagraphV3,
  ArticleSectionV3,
  ArticleTableV3,
  FidelityRisk,
  SourceBlockRole,
  SourceSegment,
  SourceTrace,
} from './rewrite.types'

/** The grounding context for finalizing one outline section's rewrite. */
export interface RewriteContext {
  /** Stable id for the section (drives minted anchor ids). */
  sectionId: string
  /** Every source block id the section may legitimately cite. */
  known: ReadonlySet<string>
  /** Role of each known block, for the analogy gate. */
  roleByBlockId: ReadonlyMap<string, SourceBlockRole>
}

/** Index a section's segments into the block-id universe + per-block role map. */
export function indexSegments(segments: SourceSegment[]): {
  known: Set<string>
  roleByBlockId: Map<string, SourceBlockRole>
} {
  const known = new Set<string>()
  const roleByBlockId = new Map<string, SourceBlockRole>()
  for (const segment of segments) {
    for (const block of segment.blocks) {
      known.add(block.id)
      roleByBlockId.set(block.id, block.role)
    }
  }
  return { known, roleByBlockId }
}

/** Keep only the ids present in the source, de-duplicated in first-seen order. */
function keepKnown(ids: string[], known: ReadonlySet<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && known.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

const RISK_RANK: Record<FidelityRisk, number> = { low: 0, medium: 1, high: 2 }

/** Return whichever of the two risks is higher. */
function maxRisk(a: FidelityRisk, b: FidelityRisk): FidelityRisk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b
}

/**
 * Normalize a paragraph's trace against the pruned ids: clamp confidence to [0,1]
 * and floor the fidelity risk so the riskier transforms can't be under-stated.
 */
function normalizeTrace(
  p: LlmParagraph,
  sourceBlockIds: string[],
): SourceTrace {
  let fidelityRisk = p.fidelityRisk
  if (p.transformationType === 'source_grounded_inference') {
    fidelityRisk = maxRisk(fidelityRisk, 'medium')
  } else if (p.transformationType === 'ai_assisted_scaffold') {
    // Scaffold framing is the least faithful transform — always high risk.
    fidelityRisk = 'high'
  }
  const confidence = Number.isFinite(p.confidence)
    ? Math.min(1, Math.max(0, p.confidence))
    : 0.5
  return {
    sourceBlockIds,
    transformationType: p.transformationType,
    fidelityRisk,
    confidence,
  }
}

/** Prune one paragraph; null when no cited block survives (unsupported → omitted). */
function finalizeParagraph(
  p: LlmParagraph,
  index: number,
  ctx: RewriteContext,
): ArticleParagraphV3 | null {
  const ids = keepKnown(p.sourceBlockIds, ctx.known)
  if (ids.length === 0) return null
  return {
    id: `${ctx.sectionId}-p${index}`,
    text: p.text,
    trace: normalizeTrace(p, ids),
  }
}

/**
 * Prune one callout; null when it is dropped. A callout is dropped when it cites no
 * surviving block, when the model flagged it `grounded: false` (AI-invented), or
 * when it claims to be a `source_analogy` but none of its surviving blocks actually
 * carries the `analogy` role.
 */
function finalizeCallout(
  c: LlmCallout,
  index: number,
  ctx: RewriteContext,
): ArticleCalloutV3 | null {
  if (c.grounded === false) return null
  const ids = keepKnown(c.sourceBlockIds, ctx.known)
  if (ids.length === 0) return null
  if (c.calloutType === 'source_analogy') {
    const hasAnalogyBlock = ids.some(
      (id) => ctx.roleByBlockId.get(id) === 'analogy',
    )
    if (!hasAnalogyBlock) return null
  }
  return {
    id: `${ctx.sectionId}-c${index}`,
    calloutType: c.calloutType,
    ...(c.title ? { title: c.title } : {}),
    text: c.text,
    sourceBlockIds: ids,
    fidelityRisk: c.fidelityRisk ?? 'low',
  }
}

/** Prune one table; null when it cites no surviving block or has no rows. */
function finalizeTable(
  t: LlmTable,
  index: number,
  ctx: RewriteContext,
): ArticleTableV3 | null {
  const ids = keepKnown(t.sourceBlockIds, ctx.known)
  if (ids.length === 0) return null
  const rows = (t.rows ?? []).filter((row) => row.length > 0)
  if (rows.length === 0) return null
  return {
    id: `${ctx.sectionId}-t${index}`,
    ...(t.caption ? { caption: t.caption } : {}),
    ...(t.header && t.header.length > 0 ? { header: t.header } : {}),
    rows,
    sourceBlockIds: ids,
    fidelityRisk: t.fidelityRisk ?? 'low',
  }
}

/** Union of every cited id across a section's content, in first-seen order. */
function unionSourceBlockIds(section: {
  paragraphs: ArticleParagraphV3[]
  callouts?: ArticleCalloutV3[]
  tables?: ArticleTableV3[]
  subsections?: ArticleSectionV3[]
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  for (const p of section.paragraphs) add(p.trace.sourceBlockIds)
  for (const c of section.callouts ?? []) add(c.sourceBlockIds)
  for (const t of section.tables ?? []) add(t.sourceBlockIds)
  for (const s of section.subsections ?? []) add(s.sourceBlockIds)
  return out
}

/**
 * Finalize one rewritten section against its grounding context. Returns null when
 * nothing traceable survives (every paragraph/callout/table was unsupported) — the
 * caller drops empty sections rather than emit a heading with no content.
 *
 * Subsections are finalized recursively (one level) under derived ids; a subsection
 * that empties out is dropped, exactly like a top-level section.
 */
export function finalizeSection(
  llm: RewriteSectionLlm,
  ctx: RewriteContext,
): ArticleSectionV3 | null {
  const paragraphs = (llm.paragraphs ?? [])
    .map((p, i) => finalizeParagraph(p, i, ctx))
    .filter((p): p is ArticleParagraphV3 => p !== null)

  const callouts = (llm.callouts ?? [])
    .map((c, i) => finalizeCallout(c, i, ctx))
    .filter((c): c is ArticleCalloutV3 => c !== null)

  const tables = (llm.tables ?? [])
    .map((t, i) => finalizeTable(t, i, ctx))
    .filter((t): t is ArticleTableV3 => t !== null)

  const subsections = (llm.subsections ?? [])
    .map((sub, i) =>
      finalizeSection(sub, { ...ctx, sectionId: `${ctx.sectionId}-s${i}` }),
    )
    .filter((s): s is ArticleSectionV3 => s !== null)

  const sourceBlockIds = unionSourceBlockIds({
    paragraphs,
    callouts,
    tables,
    subsections,
  })
  // A section with no surviving traceable content is dropped.
  if (sourceBlockIds.length === 0) return null

  const section: ArticleSectionV3 = {
    id: ctx.sectionId,
    heading: llm.heading,
    headingSource: llm.headingSource,
    sourceBlockIds,
    paragraphs,
  }
  if (callouts.length > 0) section.callouts = callouts
  if (tables.length > 0) section.tables = tables
  if (subsections.length > 0) section.subsections = subsections
  return section
}
