import type { ArticleJsonV3 } from './v3.types'

/**
 * v3 IMPORTANT-source coverage (DET-343). The acceptance criteria are written
 * against "important source coverage" (≥80% for transcript lessons, ≥70% for
 * structured articles) — NOT raw block coverage. A noisy nav block left uncited
 * must not drag coverage down; a dropped DEFINITION must. So coverage here is
 * computed over the IMPORTANT blocks only.
 *
 * "Important" = a substance classification (MAIN_ARGUMENT / DEFINITION / EXAMPLE /
 * EVIDENCE / METHOD) on a non-removable block. This mirrors the v2 classifier's
 * substance classes (the ones the coverage philosophy already protects) and is the
 * deterministic core the gate keys on. Pure function — no LLM.
 */

/** Source block as coverage consumes it (id + classification + removable flag). */
export interface CoverageBlockV3 {
  id: string
  classification: string | null
  removable: boolean
}

/** The substance classes that make a block "important" to a learner. */
const SUBSTANCE_CLASSES: ReadonlySet<string> = new Set([
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

/** Every source-block id cited anywhere in a v3 article (sections + learning). */
export function citedBlockIds(article: ArticleJsonV3): Set<string> {
  const cited = new Set<string>()
  const add = (ids: string[]) => {
    for (const id of ids) cited.add(id)
  }
  for (const s of article.sections) {
    add(s.sourceBlockIds)
    for (const b of s.blocks) add(b.sourceBlockIds)
  }
  for (const c of article.learning.keyConcepts) add(c.sourceBlockIds)
  for (const c of article.learning.keyClaims) add(c.sourceBlockIds)
  for (const p of article.learning.retrievalPrompts) add(p.sourceBlockIds)
  for (const n of article.learning.sourceNotes) add(n.sourceBlockIds)
  return cited
}

/** The important-coverage result: percent + the represented/missing partition. */
export interface ImportantCoverage {
  importantTotal: number
  representedImportantIds: string[]
  missingImportantIds: string[]
  /** represented / importantTotal, 0–100 (100 when the source has no important blocks). */
  importantCoveragePercent: number
}

/**
 * Compute important-source coverage for a generated v3 article. An important block
 * counts as covered iff some article fragment cites its id. When the source has no
 * important blocks at all (e.g. pure navigation), coverage is vacuously 100 — there
 * is nothing important to miss, so the gate must not block on it.
 */
export function buildImportantCoverage(
  article: ArticleJsonV3,
  blocks: CoverageBlockV3[],
): ImportantCoverage {
  const cited = citedBlockIds(article)
  const important = blocks.filter(isImportantBlock)
  const representedImportantIds = important
    .filter((b) => cited.has(b.id))
    .map((b) => b.id)
  const missingImportantIds = important
    .filter((b) => !cited.has(b.id))
    .map((b) => b.id)

  const importantTotal = important.length
  const importantCoveragePercent =
    importantTotal === 0
      ? 100
      : Math.round((representedImportantIds.length / importantTotal) * 100)

  return {
    importantTotal,
    representedImportantIds,
    missingImportantIds,
    importantCoveragePercent,
  }
}
