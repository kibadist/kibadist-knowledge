import type {
  ArticleBlockerCode,
  ArticleBlockerReason,
  ArticleJsonV3,
  ArticleParagraphV3,
  ArticleQualityReportV3,
  ArticleStatusV3,
  SourceKind,
} from './v3-contract'
import { isAiScaffoldingV3 } from './v3-contract'
import {
  buildImportantCoverageV3,
  type CoverageBlockV3,
} from './v3-coverage.util'

/**
 * The v3 quality gate (DET-343 / DET-355) — the deterministic heart of the engine
 * and the thing the acceptance criteria are written against. Pure function, NO LLM:
 * given a generated article + its source blocks, it produces the full
 * `ArticleQualityReportV3`, decides the `ArticleStatusV3`, and lists the blocker
 * reasons + regeneration hints the reader renders.
 *
 * The acceptance criteria, encoded directly:
 *  - transcript lessons need ≥80% important source coverage; structured/other need
 *    ≥70% (TRANSCRIPT_COVERAGE_FLOOR / DEFAULT_COVERAGE_FLOOR).
 *  - unsupported claim count MUST be 0 for READY_FOR_REVIEW.
 *  - concept-rich sources must produce at least MIN_CONCEPT_CANDIDATE_COUNT (3)
 *    concept candidates (a source WITH important definition/example substance that
 *    yields fewer than 3 key concepts is blocked — DET-355 minConceptCandidateCount).
 *  - articles must ship retrieval prompts (a learning artifact, not just prose).
 *
 * A HARD blocker keeps the article out of READY_FOR_REVIEW and maps to a specific
 * held-back `ArticleStatusV3`; a SOFT blocker is advisory (surfaced in
 * `reviewerWarnings`, never blocking). When several hard blockers fire, the status
 * is the highest-priority one (teaching a falsehood is worse than thin coverage).
 */

/** Important-coverage floor for transcript lessons (acceptance criterion). */
export const TRANSCRIPT_COVERAGE_FLOOR = 80
/** Important-coverage floor for structured/reference/other sources. */
export const DEFAULT_COVERAGE_FLOOR = 70

/** The coverage threshold a given source kind must clear. */
export function coverageThresholdFor(kind: SourceKind): number {
  return kind === 'transcript_lesson'
    ? TRANSCRIPT_COVERAGE_FLOOR
    : DEFAULT_COVERAGE_FLOOR
}

/**
 * A source is "concept-rich" when it carries important DEFINITION/EXAMPLE substance
 * — exactly the material a learner is meant to extract concepts from. Such a source
 * yielding fewer than MIN_CONCEPT_CANDIDATE_COUNT key concepts is the PRD's
 * "too few concept candidates" failure, so the gate blocks it. A source with no
 * such substance (e.g. a pure procedure) is NOT required to produce concepts.
 */
const CONCEPT_BEARING_CLASSES: ReadonlySet<string> = new Set([
  'DEFINITION',
  'EXAMPLE',
])

/**
 * The minimum number of concept candidates a concept-rich source must surface
 * (DET-355 `minConceptCandidateCount`). Below this floor the article is held back
 * with BLOCKED_MISSING_CONCEPTS — a concept-rich source that yields only one or two
 * concepts is still too thin to drive the learning loop.
 */
export const MIN_CONCEPT_CANDIDATE_COUNT = 3

export function isConceptRich(blocks: CoverageBlockV3[]): boolean {
  return blocks.some(
    (b) =>
      !b.removable &&
      b.classification != null &&
      CONCEPT_BEARING_CLASSES.has(b.classification),
  )
}

/** Below this exercise-readiness score the report flags a SOFT warning. */
export const LOW_EXERCISE_READINESS = 40

/** Flatten every paragraph in the article body (abstract + nested sections). */
function allParagraphs(article: ArticleJsonV3): ArticleParagraphV3[] {
  const out: ArticleParagraphV3[] = [...article.abstract]
  const walk = (sections: ArticleJsonV3['sections']): void => {
    for (const s of sections) {
      out.push(...s.paragraphs)
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)
  return out
}

/**
 * A 0–100 readiness score for turning the article into exercises. Heuristic +
 * deterministic: retrieval prompts and grounded concepts are the raw material of
 * exercises, so readiness rises with both (saturating), and unsupported claims and
 * thin coverage drag it down. A LOW score is advisory — never a hard gate on its
 * own (the PRD lists "low exercise readiness" as an OBSERVED symptom alongside the
 * hard coverage/claim gates).
 */
export function exerciseReadiness(
  article: ArticleJsonV3,
  importantCoveragePercent: number,
  unsupportedClaimCount: number,
): number {
  const prompts = article.retrievalPrompts.length
  const concepts = article.keyConcepts.length
  const promptScore = Math.min(prompts, 5) * 12
  const conceptScore = Math.min(concepts, 5) * 8
  const coverageScore = Math.round((importantCoveragePercent / 100) * 20)
  const penalty = unsupportedClaimCount * 10
  return Math.max(
    0,
    Math.min(100, promptScore + conceptScore + coverageScore - penalty),
  )
}

const STATUS_FOR_CODE: Record<ArticleBlockerCode, ArticleStatusV3 | null> = {
  unsupported_claims: 'BLOCKED_UNSUPPORTED_CLAIMS',
  low_coverage: 'BLOCKED_LOW_COVERAGE',
  missing_concepts: 'BLOCKED_MISSING_CONCEPTS',
  fidelity: 'BLOCKED_FIDELITY',
  lost_information: null,
  weak_exercise_readiness: null,
}

/** Held-back status precedence (worst first) when several hard blockers fire. */
const STATUS_PRIORITY: ArticleStatusV3[] = [
  'BLOCKED_UNSUPPORTED_CLAIMS',
  'BLOCKED_LOW_COVERAGE',
  'BLOCKED_MISSING_CONCEPTS',
  'BLOCKED_FIDELITY',
  'NEEDS_REGENERATION',
]

/** The gate verdict: the report + the row-facing status + the regen targets. */
export interface QualityGateResultV3 {
  status: ArticleStatusV3
  qualityReport: ArticleQualityReportV3
  /** Hard blocker codes, for the orchestrator's targeted-regeneration decision. */
  hardBlockerCodes: ArticleBlockerCode[]
}

/**
 * The `ArticleQualityReportV3` field each blocker code is grounded in. Stored on
 * the reason as `qualityReportRef` so the reader can point a blocker straight at the
 * report entry that justifies it (DET-355: "pointers to quality report entries").
 */
const QUALITY_REPORT_REF_FOR_CODE: Record<ArticleBlockerCode, string> = {
  low_coverage: 'importantSourceCoverageScore',
  unsupported_claims: 'unsupportedClaimCount',
  missing_concepts: 'conceptCandidateCount',
  fidelity: 'highSeverityLostInfoCount',
  lost_information: 'highSeverityLostInfoCount',
  weak_exercise_readiness: 'exerciseReadinessScore',
}

/** A regeneration hint per addressable blocker code. */
function regenerationHintFor(code: ArticleBlockerCode): string {
  switch (code) {
    case 'low_coverage':
      return 'Rewrite to represent the missing important source blocks; cite each one.'
    case 'unsupported_claims':
      return 'Remove or re-ground unsupported claims so every claim cites a real source block.'
    case 'missing_concepts':
      return 'Extract the key concepts the source defines or exemplifies, each grounded in its blocks.'
    case 'weak_exercise_readiness':
      return 'Add retrieval prompts whose answers the source blocks support.'
    case 'fidelity':
      return 'Re-ground the high-risk fragments to their source blocks.'
    case 'lost_information':
      return 'Recover the dropped important source material into the article body.'
  }
}

/**
 * Evaluate the quality gate. Returns the full report with `status` set to
 * READY_FOR_REVIEW (no hard blockers) or a specific held-back status. The
 * regeneration hints are populated from the addressable hard blockers so even a
 * permanently BLOCKED article tells the reader how it could be repaired.
 */
export function evaluateQualityGateV3(
  article: ArticleJsonV3,
  blocks: CoverageBlockV3[],
): QualityGateResultV3 {
  const sourceKind = article.sourceKind
  const threshold = coverageThresholdFor(sourceKind)
  const coverage = buildImportantCoverageV3(article, blocks)
  const importantCoveragePercent = coverage.importantCoveragePercent

  const unsupportedClaims = article.keyClaims.filter(
    (c) => c.sourceBlockIds.length === 0,
  )
  const unsupportedClaimCount = unsupportedClaims.length
  const conceptCandidateCount = article.keyConcepts.length
  const retrievalPromptCount = article.retrievalPrompts.length
  const readiness = exerciseReadiness(
    article,
    importantCoveragePercent,
    unsupportedClaimCount,
  )

  const paragraphs = allParagraphs(article)
  const groundedParagraphs = paragraphs.filter(
    (p) => !isAiScaffoldingV3(p),
  ).length
  const provenanceCompletenessScore =
    paragraphs.length === 0
      ? 0
      : Math.round((groundedParagraphs / paragraphs.length) * 100)
  const avgWords =
    paragraphs.length === 0
      ? 0
      : paragraphs.reduce((s, p) => s + p.text.trim().split(/\s+/).length, 0) /
        paragraphs.length
  // Readability: penalise very long unbroken paragraphs (a transcript-dump tell).
  const articleReadabilityScore = Math.max(
    0,
    Math.min(100, 100 - Math.max(0, avgWords - 80)),
  )

  const blockerReasons: ArticleBlockerReason[] = []
  const reviewerWarnings: string[] = []
  const hardBlockerCodes: ArticleBlockerCode[] = []
  const regenerationHints: string[] = []
  const hard = (
    code: ArticleBlockerCode,
    message: string,
    sourceBlockIds?: string[],
  ) => {
    blockerReasons.push({
      code,
      message,
      qualityReportRef: QUALITY_REPORT_REF_FOR_CODE[code],
      sourceBlockIds,
    })
    hardBlockerCodes.push(code)
    regenerationHints.push(regenerationHintFor(code))
  }

  // 1. Important coverage floor — the PRD's 6%/42% coverage failures.
  if (importantCoveragePercent < threshold) {
    hard(
      'low_coverage',
      `Important source coverage ${importantCoveragePercent}% is below the ${threshold}% floor for a ${sourceKind} source.`,
      coverage.missingImportantIds,
    )
  }
  // 2. Unsupported claims — must be 0 for READY_FOR_REVIEW.
  if (unsupportedClaimCount > 0) {
    hard(
      'unsupported_claims',
      `${unsupportedClaimCount} claim(s) are not supported by any source block.`,
    )
  }
  // 3. Concept-rich source with too few concepts — the PRD's "<3 concept
  //    candidates" failure (DET-355 minConceptCandidateCount).
  if (
    isConceptRich(blocks) &&
    conceptCandidateCount < MIN_CONCEPT_CANDIDATE_COUNT
  ) {
    hard(
      'missing_concepts',
      `The source carries definition/example substance but only ${conceptCandidateCount} key concept(s) were extracted (need ${MIN_CONCEPT_CANDIDATE_COUNT}).`,
    )
  }
  // 4. No retrieval prompts — an article without retrieval practice is not a
  //    LEARNING article. Addressable by regeneration, so held back (not a terminal
  //    BLOCKED_* status); the reader still shows the reason + hint.
  if (retrievalPromptCount === 0) {
    hard('weak_exercise_readiness', 'No retrieval prompts were generated.')
  }
  // 5. Low exercise readiness — advisory only (surfaced, never blocking alone).
  if (readiness < LOW_EXERCISE_READINESS && retrievalPromptCount > 0) {
    reviewerWarnings.push(
      `Exercise readiness ${readiness} is low; the article may not yield strong exercises.`,
    )
  }

  const highSeverityLostInfoCount = coverage.missingImportantIds.length

  // Status: the highest-priority held-back status among the hard blockers, or
  // READY_FOR_REVIEW when none fired. A blocker code with no dedicated BLOCKED_*
  // status (e.g. missing prompts) maps to NEEDS_REGENERATION.
  let status: ArticleStatusV3 = 'READY_FOR_REVIEW'
  if (hardBlockerCodes.length > 0) {
    const candidateStatuses = new Set<ArticleStatusV3>(
      hardBlockerCodes.map((c) => STATUS_FOR_CODE[c] ?? 'NEEDS_REGENERATION'),
    )
    status =
      STATUS_PRIORITY.find((s) => candidateStatuses.has(s)) ??
      'NEEDS_REGENERATION'
  }

  const qualityReport: ArticleQualityReportV3 = {
    sourceCoverageScore: coverage.rawCoveragePercent,
    importantSourceCoverageScore: importantCoveragePercent,
    citationCoverageScore: provenanceCompletenessScore,
    unsupportedClaimCount,
    highSeverityLostInfoCount,
    conceptCandidateCount,
    keyClaimCount: article.keyClaims.length,
    retrievalPromptCount,
    tableCount: article.tables.length,
    calloutCount:
      article.calloutPlacements.unplaced.length +
      Object.values(article.calloutPlacements.bySection).reduce(
        (s, cs) => s + cs.length,
        0,
      ),
    exerciseReadinessScore: readiness,
    articleReadabilityScore,
    provenanceCompletenessScore,
    reviewerWarnings,
    blockerReasons,
    regenerationHints,
  }

  return { status, qualityReport, hardBlockerCodes }
}
