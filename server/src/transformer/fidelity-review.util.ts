import { toArticleV2 } from './article-compat.util'
import type { LearningLayer, SourceStructureModel } from './schemas'
import type {
  ArticleBlock,
  ArticleBlockerReason,
  ArticleJsonV2,
  ArticleQualityReportV3,
  ArticleSectionV2,
  CoverageReport,
  FidelityFinding,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Fidelity review (DET-354) — the deterministic synthesiser behind the v3 quality
 * report. It NEVER calls an LLM: every dimension is computed from the artifacts
 * the earlier stages already produced (the fidelity report, the coverage report,
 * the structure model, the learning layer) plus a structural pass over the
 * article. Keeping it pure makes the gate reproducible and unit-testable, exactly
 * like `coverage.util.ts` — the model is never trusted to grade its own output.
 */

/** Minimal source-block shape the review needs (id + class + removable). */
export interface ReviewBlock {
  id: string
  /** Source-derived classification (TransformerBlockClass), or null/UNCERTAIN. */
  classification: string | null
  removable: boolean
}

export interface FidelityReviewInput {
  article: SourcePreservingArticle | ArticleJsonV2
  structureModel: SourceStructureModel
  blocks: ReviewBlock[]
  fidelityReport: FidelityReport
  coverageReport: CoverageReport
  learningLayer: LearningLayer
}

/**
 * Source classes that carry the SUBSTANCE a learner must not lose. Coverage of
 * these blocks is the `importantSourceCoverageScore` numerator; a gap here blocks
 * even when raw coverage looks healthy (a thin article can cite the easy blocks
 * and quietly drop every claim/definition).
 */
const IMPORTANT_CLASSES: ReadonlySet<string> = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EVIDENCE',
  'METHOD',
  'EXAMPLE',
])

/** Below this, important source coverage is a blocking gap (mirrors the §95 gate). */
const IMPORTANT_COVERAGE_MIN = 90
/** Below this, exercise readiness is a non-blocking advisory. */
const EXERCISE_READINESS_MIN = 50
/** Above this many words/paragraph the prose reads as a wall of text. */
const LONG_PARAGRAPH_WORDS = 150
const VERY_LONG_PARAGRAPH_WORDS = 220

/** Round to an integer 0–100. */
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Walk every body block of a v2 article (abstract excluded — it's paragraphs). */
function forEachSectionBlock(
  article: ArticleJsonV2,
  visit: (block: ArticleBlock, section: ArticleSectionV2) => void,
): void {
  const walk = (s: ArticleSectionV2) => {
    for (const b of s.blocks) visit(b, s)
    for (const sub of s.subsections ?? []) walk(sub)
  }
  for (const s of article.sections) walk(s)
}

/** High-severity findings only. */
function high(findings: FidelityFinding[]): FidelityFinding[] {
  return findings.filter((f) => f.severity === 'high')
}

/** Collect the distinct articleRefs carried by a set of findings. */
function refsOf(findings: FidelityFinding[]): string[] {
  const out = new Set<string>()
  for (const f of findings) if (f.articleRef) out.add(f.articleRef)
  return [...out]
}

/** Collect the distinct sourceBlockIds carried by a set of findings. */
function sourceIdsOf(findings: FidelityFinding[]): string[] {
  const out = new Set<string>()
  for (const f of findings) for (const id of f.sourceBlockIds ?? []) out.add(id)
  return [...out]
}

/**
 * The set of IMPORTANT source-block ids: every block the structure model cited as
 * a claim / caveat / definition / example / terminology item, UNION every kept
 * block the classifier put in a high-value class. Restricted to real, non-removable
 * blocks so a hallucinated id never inflates the denominator.
 */
export function importantBlockIds(
  structureModel: SourceStructureModel,
  blocks: ReviewBlock[],
): Set<string> {
  const keep = new Set(blocks.filter((b) => !b.removable).map((b) => b.id))
  const important = new Set<string>()
  const cite = (ids: string[]) => {
    for (const id of ids) if (keep.has(id)) important.add(id)
  }
  for (const c of structureModel.claims) cite(c.sourceBlockIds)
  for (const c of structureModel.caveats) cite(c.sourceBlockIds)
  for (const d of structureModel.definitions) cite(d.sourceBlockIds)
  for (const e of structureModel.examples) cite(e.sourceBlockIds)
  for (const t of structureModel.terminology) cite(t.sourceBlockIds)
  for (const b of blocks) {
    if (b.removable) continue
    if (b.classification && IMPORTANT_CLASSES.has(b.classification))
      important.add(b.id)
  }
  return important
}

/**
 * Build the v3 quality report for an article (DET-354). Pure: no LLM, no I/O.
 */
export function buildArticleQualityReport(
  input: FidelityReviewInput,
): ArticleQualityReportV3 {
  const article = toArticleV2(input.article)
  const {
    structureModel,
    blocks,
    fidelityReport,
    coverageReport,
    learningLayer,
  } = input

  const known = new Set(blocks.map((b) => b.id))
  const represented = new Set(coverageReport.representedBlockIds)

  // --- Raw vs important coverage --------------------------------------------
  const sourceCoverageScore = clampScore(coverageReport.coveragePercent)

  const important = importantBlockIds(structureModel, blocks)
  const importantRepresented = [...important].filter((id) =>
    represented.has(id),
  )
  const lostImportant = [...important].filter((id) => !represented.has(id))
  const importantSourceCoverageScore =
    important.size === 0
      ? 100
      : clampScore((importantRepresented.length / important.size) * 100)

  // --- Citation + provenance over the article's own fragments ----------------
  // A traceable fragment carries sourceBlockIds. "Citation coverage" measures the
  // article BODY (abstract paragraphs + section blocks): does each cite a source?
  // "Provenance completeness" is stricter and broader — it spans EVERY fragment
  // (incl. subtitle / keyTerms / examples / caveats / highlights) and requires the
  // cited ids to actually EXIST, surfacing missing source traces.
  let bodyTotal = 0
  let bodyCited = 0
  let provTotal = 0
  let provComplete = 0
  const untraceableRefs: string[] = []

  const traceable = (
    id: string,
    sourceBlockIds: string[],
    countBody: boolean,
  ) => {
    const hasAny = sourceBlockIds.length > 0
    const allKnown = hasAny && sourceBlockIds.every((b) => known.has(b))
    if (countBody) {
      bodyTotal++
      if (hasAny) bodyCited++
    }
    provTotal++
    if (allKnown) provComplete++
    else untraceableRefs.push(id)
  }

  for (const p of article.abstract) traceable(p.id, p.sourceBlockIds, true)
  forEachSectionBlock(article, (b) => traceable(b.id, b.sourceBlockIds, true))
  if (article.subtitle)
    traceable('subtitle', article.subtitle.sourceBlockIds, false)
  article.keyTerms.forEach((t, i) =>
    traceable(`keyTerm-${i}`, t.sourceBlockIds, false),
  )
  article.sourceExamples.forEach((e, i) =>
    traceable(`example-${i}`, e.sourceBlockIds, false),
  )
  article.caveats.forEach((c, i) =>
    traceable(`caveat-${i}`, c.sourceBlockIds, false),
  )
  ;(article.readingAids?.highlights ?? []).forEach((h, i) =>
    traceable(`highlight-${i}`, h.sourceBlockIds, false),
  )

  const citationCoverageScore =
    bodyTotal === 0 ? 100 : clampScore((bodyCited / bodyTotal) * 100)
  const provenanceCompletenessScore =
    provTotal === 0 ? 100 : clampScore((provComplete / provTotal) * 100)

  // --- Fidelity-derived counts ----------------------------------------------
  const addedFindings = [
    ...fidelityReport.addedInformation,
    ...fidelityReport.unsupportedExamples,
  ]
  const unsupportedClaimCount = addedFindings.length
  const lostFindings = [
    ...fidelityReport.lostInformation,
    ...fidelityReport.missingCaveats,
  ]
  const highSeverityLostInfoCount = high(lostFindings).length

  // --- Learning-layer counts -------------------------------------------------
  const conceptCandidateCount =
    learningLayer.concepts.length +
    (learningLayer.conceptCandidates?.length ?? 0)
  const retrievalPromptCount = learningLayer.retrievalPrompts.length
  const keyClaimCount = structureModel.claims.length

  // --- Structural counts -----------------------------------------------------
  let tableCount = 0
  let calloutCount = 0
  let paragraphCount = 0
  let paragraphWords = 0
  let maxBlocksInSection = 0
  forEachSectionBlock(article, (b, s) => {
    if (b.type === 'table') tableCount++
    if (b.type === 'callout') calloutCount++
    if (b.type === 'paragraph') {
      paragraphCount++
      paragraphWords += wordCount(b.text)
    }
    maxBlocksInSection = Math.max(maxBlocksInSection, s.blocks.length)
  })

  // --- Exercise readiness ----------------------------------------------------
  const ratio = (have: number, want: number) =>
    want <= 0 ? (have > 0 ? 1 : 0) : Math.min(1, have / want)
  const retrievalRatio = ratio(retrievalPromptCount, keyClaimCount)
  const conceptRatio = ratio(conceptCandidateCount, keyClaimCount)
  const exerciseReadinessScore = clampScore(
    100 * (0.5 * retrievalRatio + 0.5 * conceptRatio),
  )

  // --- Readability heuristic -------------------------------------------------
  let readability = 100
  if (article.abstract.length === 0) readability -= 15
  if (article.sections.length === 0) readability -= 25
  const avgWords = paragraphCount === 0 ? 0 : paragraphWords / paragraphCount
  if (avgWords > VERY_LONG_PARAGRAPH_WORDS) readability -= 20
  else if (avgWords > LONG_PARAGRAPH_WORDS) readability -= 10
  if (maxBlocksInSection > 14) readability -= 10
  const articleReadabilityScore = clampScore(readability)

  // --- Blocker reasons + warnings -------------------------------------------
  const blockerReasons: ArticleBlockerReason[] = []
  const reviewerWarnings: string[] = []

  // (1) Unsupported additions — tied to the article refs that introduced them.
  const highAdded = high(addedFindings)
  if (highAdded.length > 0) {
    blockerReasons.push({
      code: 'unsupported_claims',
      dimension: 'Unsupported additions',
      severity: 'high',
      message: `${highAdded.length} unsupported addition(s) not grounded in any source block${
        refsOf(highAdded).length
          ? ` (article refs: ${refsOf(highAdded).join(', ')})`
          : ''
      }.`,
      articleRefs: refsOf(highAdded),
      stage: 'generator',
    })
  } else if (unsupportedClaimCount > 0) {
    reviewerWarnings.push(
      `${unsupportedClaimCount} low/medium unsupported addition(s) flagged; review wording for added meaning.`,
    )
  }

  // (2) Lost high-importance information — tied to the source block ids dropped.
  const highLost = high(lostFindings)
  if (highLost.length > 0) {
    blockerReasons.push({
      code: 'lost_information',
      dimension: 'Lost information',
      severity: 'high',
      message: `${highLost.length} high-severity source claim(s)/caveat(s) lost from the article.`,
      sourceBlockIds: sourceIdsOf(highLost),
      stage: 'generator',
    })
  }

  // (3) Important source coverage gap — distinct from raw coverage on purpose.
  if (importantSourceCoverageScore < IMPORTANT_COVERAGE_MIN) {
    blockerReasons.push({
      code: 'important_coverage_gap',
      dimension: 'Important source coverage',
      severity: 'high',
      message: `Only ${importantSourceCoverageScore}% of important source blocks are represented (${lostImportant.length} of ${important.size} dropped); raw coverage is ${sourceCoverageScore}%.`,
      sourceBlockIds: lostImportant,
      stage: 'reshaping-plan',
    })
  } else if (lostImportant.length > 0) {
    reviewerWarnings.push(
      `${lostImportant.length} important source block(s) not represented (important coverage ${importantSourceCoverageScore}%).`,
    )
  }

  // (4) Missing source traces — weak provenance is untrustworthy.
  if (provenanceCompletenessScore < 100) {
    blockerReasons.push({
      code: 'missing_source_traces',
      dimension: 'Provenance completeness',
      severity: 'high',
      message: `${untraceableRefs.length} article fragment(s) lack valid source traces (provenance ${provenanceCompletenessScore}%).`,
      articleRefs: untraceableRefs,
      stage: 'generator',
    })
  }

  // (5) Meaning changes / emphasis shifts / unaudited structure (mirror fidelity).
  const highMeaning = high(fidelityReport.meaningChanges)
  if (highMeaning.length > 0) {
    blockerReasons.push({
      code: 'meaning_change',
      dimension: 'Meaning changes',
      severity: 'high',
      message: `${highMeaning.length} source claim(s) strengthened, weakened, or altered.`,
      articleRefs: refsOf(highMeaning),
      sourceBlockIds: sourceIdsOf(highMeaning),
      stage: 'generator',
    })
  }
  const highEmphasis = high(fidelityReport.emphasisChanges)
  if (highEmphasis.length > 0) {
    blockerReasons.push({
      code: 'emphasis_shift',
      dimension: 'Emphasis / reordering',
      severity: 'high',
      message: `${highEmphasis.length} structural emphasis shift(s) (unaudited reorder or display over-emphasis) change the reader's takeaway.`,
      articleRefs: refsOf(highEmphasis),
      sourceBlockIds: sourceIdsOf(highEmphasis),
      stage: 'reshaping-plan',
    })
  }
  const highStructural = high([
    ...fidelityReport.structuralFindings,
    ...fidelityReport.unsupportedHeadings,
  ])
  if (highStructural.length > 0) {
    blockerReasons.push({
      code: 'structural_finding',
      dimension: 'Structural fidelity',
      severity: 'high',
      message: `${highStructural.length} structural finding(s) (flattened list/table, separated claim/caveat, or unsupported heading) lose source meaning.`,
      articleRefs: refsOf(highStructural),
      sourceBlockIds: sourceIdsOf(highStructural),
      stage: 'reshaping-plan',
    })
  }

  // (6) Missing concepts / weak exercise readiness — learning-layer advisories.
  // These are NON-blocking by design: learning extraction is best-effort (the
  // article is still faithful without it), so a thin learning layer must not hold
  // a fidelity-clean article BLOCKED. They surface as warnings so a re-run can
  // still target the learning-layer stage.
  if (keyClaimCount > 0 && conceptCandidateCount === 0) {
    reviewerWarnings.push(
      `No grounded concepts were extracted from a source with ${keyClaimCount} key claim(s) — re-run learning extraction.`,
    )
  } else if (exerciseReadinessScore < EXERCISE_READINESS_MIN) {
    reviewerWarnings.push(
      `Exercise readiness is low (${exerciseReadinessScore}%): ${conceptCandidateCount} concept(s), ${retrievalPromptCount} retrieval prompt(s) for ${keyClaimCount} key claim(s).`,
    )
  }

  if (retrievalPromptCount === 0) {
    reviewerWarnings.push('No grounded retrieval prompts were generated.')
  }

  // --- Regeneration hints (stage-targeted, derived from the blockers) --------
  const regenerationHints = buildRegenerationHints(blockerReasons)

  return {
    sourceCoverageScore,
    importantSourceCoverageScore,
    citationCoverageScore,
    unsupportedClaimCount,
    highSeverityLostInfoCount,
    conceptCandidateCount,
    keyClaimCount,
    retrievalPromptCount,
    tableCount,
    calloutCount,
    exerciseReadinessScore,
    articleReadabilityScore,
    provenanceCompletenessScore,
    reviewerWarnings,
    blockerReasons,
    regenerationHints,
  }
}

/** True when any blocker is high-severity (the review's gate signal). */
export function isBlockedByReview(report: ArticleQualityReportV3): boolean {
  return report.blockerReasons.some((r) => r.severity === 'high')
}

/**
 * Derive actionable, stage-targeted hints from the blockers — one per affected
 * stage, in pipeline order, naming the specific blockers it must resolve. A re-run
 * uses these to know WHICH stage to regenerate, not just THAT something failed.
 */
function buildRegenerationHints(blockers: ArticleBlockerReason[]): string[] {
  const high = blockers.filter((b) => b.severity === 'high')
  if (high.length === 0) return []

  const byStage = new Map<string, ArticleBlockerReason[]>()
  for (const b of high) {
    const list = byStage.get(b.stage) ?? []
    list.push(b)
    byStage.set(b.stage, list)
  }

  const STAGE_ORDER: ArticleBlockerReason['stage'][] = [
    'structure-model',
    'reshaping-plan',
    'generator',
    'learning-layer',
  ]
  const STAGE_ACTION: Record<ArticleBlockerReason['stage'], string> = {
    'structure-model':
      'Re-run the structure model to inventory the missing source substance',
    'reshaping-plan':
      'Revise the reshaping plan to restore coverage and audit any reordering',
    generator:
      'Regenerate the article to remove unsupported additions and restore lost, fully-traced source text',
    'learning-layer':
      'Re-run learning extraction to ground concepts and retrieval prompts',
  }

  const hints: string[] = []
  for (const stage of STAGE_ORDER) {
    const list = byStage.get(stage)
    if (!list || list.length === 0) continue
    const codes = list.map((b) => b.code).join(', ')
    hints.push(`${STAGE_ACTION[stage]} (fixes: ${codes}).`)
  }
  return hints
}

/** Whitespace word count. */
function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}
