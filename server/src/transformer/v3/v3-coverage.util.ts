import type { ArticleJsonV3, ArticleSectionV3 } from './v3-contract'

/**
 * v3 IMPORTANT-source coverage (DET-343 / DET-354). The acceptance criteria are
 * written against "important source coverage" (≥80% for transcript lessons, ≥70%
 * for structured articles) — NOT raw block coverage. A noisy nav block left
 * uncited must not drag coverage down; a dropped DEFINITION must. So coverage here
 * is computed over the IMPORTANT blocks only.
 *
 * "Important" = a substance classification (MAIN_ARGUMENT / DEFINITION / EXAMPLE /
 * EVIDENCE / METHOD) on a non-removable block — the v2 classifier's substance
 * classes (the ones the coverage philosophy already protects). Pure — no LLM.
 */

/** Source block as coverage consumes it (id + classification + removable flag). */
export interface CoverageBlockV3 {
  id: string
  classification: string | null
  removable: boolean
}

/** The substance classes that make a block "important" to a learner. */
export const SUBSTANCE_CLASSES: ReadonlySet<string> = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EXAMPLE',
  'EVIDENCE',
  'METHOD',
])

/** Whether a block carries learner-important substance (and isn't noise). */
export function isImportantBlock(block: CoverageBlockV3): boolean {
  return (
    !block.removable &&
    block.classification != null &&
    SUBSTANCE_CLASSES.has(block.classification)
  )
}

/** Recurse a section tree collecting every cited source-block id. */
function collectSectionIds(section: ArticleSectionV3, into: Set<string>): void {
  for (const id of section.sourceBlockIds) into.add(id)
  for (const p of section.paragraphs) {
    for (const id of p.sourceBlockIds) into.add(id)
  }
  for (const sub of section.subsections ?? []) collectSectionIds(sub, into)
}

/** Every source-block id cited ANYWHERE in a v3 article (body + learning layer). */
export function citedBlockIdsV3(article: ArticleJsonV3): Set<string> {
  const cited = new Set<string>()
  const add = (ids: string[] | undefined) => {
    for (const id of ids ?? []) cited.add(id)
  }
  for (const p of article.abstract) add(p.sourceBlockIds)
  for (const s of article.sections) collectSectionIds(s, cited)
  for (const c of article.keyConcepts) add(c.sourceBlockIds)
  for (const c of article.keyClaims) add(c.sourceBlockIds)
  for (const t of article.terminology) add(t.sourceBlockIds)
  for (const e of article.sourceExamples) add(e.sourceBlockIds)
  for (const m of article.misconceptionWarnings) add(m.sourceBlockIds)
  for (const p of article.retrievalPrompts) add(p.expectedAnswerSourceBlockIds)
  for (const callouts of Object.values(article.calloutPlacements.bySection)) {
    for (const c of callouts) add(c.sourceBlockIds)
  }
  for (const c of article.calloutPlacements.unplaced) add(c.sourceBlockIds)
  for (const t of article.tables) add(t.sourceBlockIds)
  return cited
}

/** The important-coverage result: percent + the represented/missing partition. */
export interface ImportantCoverageV3 {
  importantTotal: number
  representedImportantIds: string[]
  missingImportantIds: string[]
  /** All non-removable blocks (the raw-coverage denominator). */
  representableTotal: number
  representedAnyIds: string[]
  /** represented / importantTotal, 0–100 (100 when no important blocks exist). */
  importantCoveragePercent: number
  /** representedAny / representableTotal, 0–100 (raw source coverage). */
  rawCoveragePercent: number
}

/**
 * Compute important-source coverage for a generated v3 article. An important block
 * counts as covered iff some article fragment cites its id. When the source has no
 * important blocks at all (e.g. pure navigation), coverage is vacuously 100 — there
 * is nothing important to miss, so the gate must not block on it.
 */
export function buildImportantCoverageV3(
  article: ArticleJsonV3,
  blocks: CoverageBlockV3[],
): ImportantCoverageV3 {
  const cited = citedBlockIdsV3(article)
  const important = blocks.filter(isImportantBlock)
  const representedImportantIds = important
    .filter((b) => cited.has(b.id))
    .map((b) => b.id)
  const missingImportantIds = important
    .filter((b) => !cited.has(b.id))
    .map((b) => b.id)

  const representable = blocks.filter((b) => !b.removable)
  const representedAnyIds = representable
    .filter((b) => cited.has(b.id))
    .map((b) => b.id)

  const importantTotal = important.length
  const importantCoveragePercent =
    importantTotal === 0
      ? 100
      : Math.round((representedImportantIds.length / importantTotal) * 100)
  const representableTotal = representable.length
  const rawCoveragePercent =
    representableTotal === 0
      ? 100
      : Math.round((representedAnyIds.length / representableTotal) * 100)

  return {
    importantTotal,
    representedImportantIds,
    missingImportantIds,
    representableTotal,
    representedAnyIds,
    importantCoveragePercent,
    rawCoveragePercent,
  }
}
