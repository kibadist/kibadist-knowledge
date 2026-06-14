/**
 * Article JSON v3 regression metrics + release gate (DET-361).
 *
 * The v3 (Source-Grounded Learning Article) pipeline is the release gate for
 * making v3 the default generator (architecture note on the ticket). Before that
 * switch flips, EVERY known article-generation failure must stay fixed — measured
 * by deterministic, network-free metrics over a hand-authored v3 article + its
 * source blocks:
 *
 *  - `conceptCandidateCount` — how many learnable concepts were extracted. A
 *    concept-rich source that yields 0 is the canonical v2-style regression
 *    (`schemas.ts` documents the same `conceptCandidateCount: 0` failure mode).
 *  - `retrievalPromptCount` — how many active-recall prompts were produced.
 *  - `importantCoverage` — the fraction of IMPORTANT (non-removable) source
 *    blocks that the article actually represents via a grounded citation. Low
 *    coverage means the article dropped material the learner needs.
 *  - `unsupportedClaimCount` — key claims that are NOT source-supported (an
 *    ungrounded claim, or a grounded claim citing a block the source does not
 *    contain). The default source-grounded mode must keep this at 0.
 *  - `unknownGroundedCitations` — any grounded trace anywhere in the article that
 *    cites a block id the source never defined (a traceability break).
 *  - `status` — `ready` when the recomputed quality report approves, else
 *    `blocked`.
 *
 * Everything here is a PURE function over the committed v3 contract — no LLM, no
 * IO — so the regression suite is reproducible and fails loudly in CI.
 */

import type {
  ArticleBlock,
  ArticleJsonV3,
  ArticleSection,
  SourceTrace,
} from './article-v3.types'
import type { ClassifiedBlockInput } from './structure-model.service'

/** The deterministic regression metrics computed over a v3 article. */
export interface RegressionMetrics {
  /** `keyConcepts.length` — extracted learnable concept candidates. */
  conceptCandidateCount: number
  /** `retrievalPrompts.length` — active-recall prompts produced. */
  retrievalPromptCount: number
  /** Key claims that are not source-supported (ungrounded or untraceable). */
  unsupportedClaimCount: number
  /** Every grounded citation (anywhere) pointing at an unknown source block. */
  unknownGroundedCitations: string[]
  /** Important (non-removable) source blocks in the input. */
  importantBlockCount: number
  /** Important blocks represented by at least one grounded citation. */
  coveredImportantBlockCount: number
  /** `coveredImportantBlockCount / importantBlockCount` in [0, 1] (1 if none). */
  importantCoverage: number
  /** `ready` when the article's quality report approves, else `blocked`. */
  status: 'ready' | 'blocked'
}

/** The thresholds a fixture must clear for v3 to be release-eligible. */
export interface ReleaseGateThresholds {
  /** Minimum `importantCoverage` (0..1). */
  minImportantCoverage: number
  /** Minimum `conceptCandidateCount`. */
  minConceptCandidates: number
  /** Minimum `retrievalPromptCount`. */
  minRetrievalPrompts: number
  /** Maximum tolerated `unsupportedClaimCount` (0 for source-grounded mode). */
  maxUnsupportedClaims: number
}

/** The outcome of evaluating a v3 article against release-gate thresholds. */
export interface ReleaseGateResult {
  passed: boolean
  /** Human-readable reasons the gate failed (empty when `passed`). */
  failures: string[]
  metrics: RegressionMetrics
}

/** The known universe of source block ids the article may cite. */
export function knownBlockIds(blocks: ClassifiedBlockInput[]): Set<string> {
  return new Set(blocks.map((b) => b.id))
}

/** Important source blocks the article is expected to cover (non-removable). */
function importantBlocks(
  blocks: ClassifiedBlockInput[],
): ClassifiedBlockInput[] {
  return blocks.filter((b) => !b.removable)
}

/** True when a trace is grounded and therefore must cite real source blocks. */
function isGrounded(trace: SourceTrace | undefined): trace is SourceTrace {
  return !!trace && trace.grounded
}

/** Walk a section + its subsections, visiting each block. */
function eachBlock(
  sections: ArticleSection[],
  visit: (b: ArticleBlock) => void,
): void {
  for (const s of sections) {
    for (const b of s.blocks) visit(b)
    if (s.subsections) eachBlock(s.subsections, visit)
  }
}

/** Walk a section + its subsections, visiting each section. */
function eachSection(
  sections: ArticleSection[],
  visit: (s: ArticleSection) => void,
): void {
  for (const s of sections) {
    visit(s)
    if (s.subsections) eachSection(s.subsections, visit)
  }
}

/**
 * Collect EVERY source block id the article cites through a GROUNDED trace, across
 * every content surface: title, abstract, learning path, sections/subsections and
 * their blocks, concepts, claims, terminology, examples, misconceptions, prompts,
 * callouts (placed + unplaced), tables, source notes and references. Ungrounded
 * traces (model scaffolding) contribute nothing — by contract they carry no ids.
 */
export function collectGroundedSourceBlockIds(
  article: ArticleJsonV3,
): Set<string> {
  const ids = new Set<string>()
  const add = (trace: SourceTrace | undefined) => {
    if (isGrounded(trace)) for (const id of trace.sourceBlockIds) ids.add(id)
  }

  add(article.title.sourceTrace)
  for (const p of article.abstract) add(p.sourceTrace)
  for (const lp of article.learningPath) add(lp.sourceTrace)

  eachSection(article.sections, (s) => add(s.sourceTrace))
  eachBlock(article.sections, (b) => add(b.sourceTrace))

  for (const c of article.keyConcepts) add(c.sourceTrace)
  for (const c of article.keyClaims) add(c.sourceTrace)
  for (const t of article.terminology) add(t.sourceTrace)
  for (const e of article.sourceExamples) add(e.sourceTrace)
  for (const m of article.misconceptionWarnings) add(m.sourceTrace)
  for (const p of article.retrievalPrompts) add(p.sourceTrace)

  for (const list of Object.values(article.calloutPlacements.bySection))
    for (const co of list) add(co.sourceTrace)
  for (const co of article.calloutPlacements.unplaced) add(co.sourceTrace)

  for (const t of article.tables) add(t.sourceTrace)
  for (const n of article.sourceNotes) add(n.sourceTrace)
  for (const r of article.references) add(r.sourceTrace)

  return ids
}

/**
 * Every grounded citation, anywhere in the article, that points at a block id the
 * source does not contain — the traceability break the v3 pipeline must reject in
 * code (the schema only checks that a grounded trace cites SOMETHING, not that the
 * id exists). Returned sorted + de-duplicated.
 */
export function findUnknownGroundedCitations(
  article: ArticleJsonV3,
  known: Set<string>,
): string[] {
  const cited = collectGroundedSourceBlockIds(article)
  return [...cited].filter((id) => !known.has(id)).sort()
}

/** `keyConcepts.length`. */
export function conceptCandidateCount(article: ArticleJsonV3): number {
  return article.keyConcepts.length
}

/** `retrievalPrompts.length`. */
export function retrievalPromptCount(article: ArticleJsonV3): number {
  return article.retrievalPrompts.length
}

/**
 * Key claims that are NOT source-supported: an ungrounded claim (a claim must be
 * grounded in the source — it is an assertion the source makes), or a grounded
 * claim that cites a block the source does not contain. In the default
 * source-grounded mode this must be 0.
 */
export function countUnsupportedClaims(
  article: ArticleJsonV3,
  known: Set<string>,
): number {
  let n = 0
  for (const claim of article.keyClaims) {
    const trace = claim.sourceTrace
    if (!trace.grounded) {
      n += 1
      continue
    }
    if (trace.sourceBlockIds.some((id) => !known.has(id))) n += 1
  }
  return n
}

/**
 * Fraction of important (non-removable) source blocks represented by at least one
 * grounded citation. A source with no important blocks is vacuously fully covered
 * (returns 1).
 */
export function importantCoverage(
  article: ArticleJsonV3,
  blocks: ClassifiedBlockInput[],
): number {
  const important = importantBlocks(blocks)
  if (important.length === 0) return 1
  const grounded = collectGroundedSourceBlockIds(article)
  const covered = important.filter((b) => grounded.has(b.id)).length
  return covered / important.length
}

/** `ready` when the quality report approves, else `blocked`. */
export function articleStatus(article: ArticleJsonV3): 'ready' | 'blocked' {
  return article.qualityReport.approved ? 'ready' : 'blocked'
}

/** Compute the full regression metric set for a v3 article + its source blocks. */
export function computeRegressionMetrics(
  article: ArticleJsonV3,
  blocks: ClassifiedBlockInput[],
): RegressionMetrics {
  const known = knownBlockIds(blocks)
  const important = importantBlocks(blocks)
  const grounded = collectGroundedSourceBlockIds(article)
  const covered = important.filter((b) => grounded.has(b.id))
  return {
    conceptCandidateCount: conceptCandidateCount(article),
    retrievalPromptCount: retrievalPromptCount(article),
    unsupportedClaimCount: countUnsupportedClaims(article, known),
    unknownGroundedCitations: findUnknownGroundedCitations(article, known),
    importantBlockCount: important.length,
    coveredImportantBlockCount: covered.length,
    importantCoverage:
      important.length === 0 ? 1 : covered.length / important.length,
    status: articleStatus(article),
  }
}

/**
 * Evaluate a v3 article against the release-gate thresholds. A `passed: false`
 * result is exactly what CI keys on — it lists every threshold the article missed
 * so a regression names itself. A blocked article (`status: 'blocked'`) can never
 * pass the gate: the gate is about release-READY output.
 */
export function evaluateReleaseGate(
  article: ArticleJsonV3,
  blocks: ClassifiedBlockInput[],
  thresholds: ReleaseGateThresholds,
): ReleaseGateResult {
  const metrics = computeRegressionMetrics(article, blocks)
  const failures: string[] = []

  if (metrics.status !== 'ready')
    failures.push(`status is ${metrics.status}, expected ready`)
  if (metrics.conceptCandidateCount < thresholds.minConceptCandidates)
    failures.push(
      `conceptCandidateCount ${metrics.conceptCandidateCount} < ${thresholds.minConceptCandidates}`,
    )
  if (metrics.retrievalPromptCount < thresholds.minRetrievalPrompts)
    failures.push(
      `retrievalPromptCount ${metrics.retrievalPromptCount} < ${thresholds.minRetrievalPrompts}`,
    )
  if (metrics.importantCoverage < thresholds.minImportantCoverage)
    failures.push(
      `importantCoverage ${metrics.importantCoverage.toFixed(2)} < ${thresholds.minImportantCoverage}`,
    )
  if (metrics.unsupportedClaimCount > thresholds.maxUnsupportedClaims)
    failures.push(
      `unsupportedClaimCount ${metrics.unsupportedClaimCount} > ${thresholds.maxUnsupportedClaims}`,
    )
  if (metrics.unknownGroundedCitations.length > 0)
    failures.push(
      `untraceable grounded citations: ${metrics.unknownGroundedCitations.join(', ')}`,
    )

  return { passed: failures.length === 0, failures, metrics }
}
