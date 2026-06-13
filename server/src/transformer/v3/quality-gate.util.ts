import type {
  ArticleJsonV3,
  BlockerCode,
  QualityBlocker,
  QualityReport,
  SourceKind,
  V3ArticleStatus,
} from './v3.types'
import {
  buildImportantCoverage,
  type CoverageBlockV3,
} from './v3-coverage.util'

/**
 * The v3 quality gate (DET-343) — the deterministic heart of the engine and the
 * thing the acceptance criteria are written against. Pure function, NO LLM: given
 * a generated article + its source blocks, it decides READY_FOR_REVIEW vs BLOCKED
 * vs NEEDS_REGENERATION and lists the blockers.
 *
 * The acceptance criteria, encoded directly:
 *  - transcript lessons need ≥80% important source coverage; structured/other need
 *    ≥70% (TRANSCRIPT_COVERAGE_FLOOR / DEFAULT_COVERAGE_FLOOR).
 *  - unsupported claim count MUST be 0 for READY_FOR_REVIEW.
 *  - concept-rich sources must produce concept candidates (a source WITH important
 *    definition/example substance that yields zero key concepts is blocked).
 *  - articles must ship retrieval prompts (a learning artifact, not just prose).
 *
 * Hard vs soft blockers: a HARD blocker keeps the article out of READY_FOR_REVIEW;
 * a SOFT one is advisory (surfaced, never blocking). Whether a hard-blocked article
 * is BLOCKED or NEEDS_REGENERATION is decided by `regeneration.util.ts`, which asks
 * whether the blockers are addressable by a targeted regen pass — the gate itself
 * only reports BLOCKED for any hard failure and lets the pipeline downgrade it.
 */

/** Important-coverage floor for transcript lessons (acceptance criterion). */
export const TRANSCRIPT_COVERAGE_FLOOR = 80
/** Important-coverage floor for structured/reference/mixed sources. */
export const DEFAULT_COVERAGE_FLOOR = 70

/** The coverage threshold a given source kind must clear. */
export function coverageThresholdFor(kind: SourceKind): number {
  return kind === 'transcript'
    ? TRANSCRIPT_COVERAGE_FLOOR
    : DEFAULT_COVERAGE_FLOOR
}

/**
 * A source is "concept-rich" when it carries important DEFINITION/EXAMPLE substance
 * — exactly the material a learner is meant to extract concepts from. Such a source
 * yielding zero key concepts is the PRD's "0 concept candidates" failure, so the
 * gate blocks it. A source with no such substance (e.g. a pure procedure) is NOT
 * required to produce concepts.
 */
const CONCEPT_BEARING_CLASSES: ReadonlySet<string> = new Set([
  'DEFINITION',
  'EXAMPLE',
])

export function isConceptRich(blocks: CoverageBlockV3[]): boolean {
  return blocks.some(
    (b) =>
      !b.removable &&
      b.classification != null &&
      CONCEPT_BEARING_CLASSES.has(b.classification),
  )
}

/**
 * A 0–100 readiness score for turning the article into exercises. Heuristic +
 * deterministic: retrieval prompts and grounded concepts are the raw material of
 * exercises, so readiness rises with both (saturating), and unsupported claims and
 * thin coverage drag it down. Surfaced in the report; a LOW score is a SOFT blocker
 * (advisory) — never a hard gate on its own (the PRD lists "low exercise readiness"
 * as an OBSERVED symptom, alongside the hard coverage/claim gates).
 */
export function exerciseReadiness(
  article: ArticleJsonV3,
  importantCoveragePercent: number,
  unsupportedClaimCount: number,
): number {
  const prompts = article.learning.retrievalPrompts.length
  const concepts = article.learning.keyConcepts.length
  // Each retrieval prompt is worth 12 pts (saturating at ~5), each grounded
  // concept 8 pts (saturating at ~5); coverage contributes up to 20.
  const promptScore = Math.min(prompts, 5) * 12
  const conceptScore = Math.min(concepts, 5) * 8
  const coverageScore = Math.round((importantCoveragePercent / 100) * 20)
  const penalty = unsupportedClaimCount * 10
  const raw = promptScore + conceptScore + coverageScore - penalty
  return Math.max(0, Math.min(100, raw))
}

/** Below this exercise-readiness score the report flags a SOFT blocker. */
export const LOW_EXERCISE_READINESS = 40

/**
 * Evaluate the quality gate. Returns the full `QualityReport` with `status` set to
 * READY_FOR_REVIEW (no hard blockers) or BLOCKED (≥1 hard blocker). The pipeline
 * may downgrade BLOCKED → NEEDS_REGENERATION via `planRegeneration`.
 */
export function evaluateQualityGate(
  article: ArticleJsonV3,
  blocks: CoverageBlockV3[],
): QualityReport {
  const sourceKind = article.sourceKind
  const threshold = coverageThresholdFor(sourceKind)
  const coverage = buildImportantCoverage(article, blocks)
  const importantCoveragePercent = coverage.importantCoveragePercent

  const unsupportedClaims = article.learning.keyClaims.filter(
    (c) => c.support === 'unsupported',
  )
  const unsupportedClaimCount = unsupportedClaims.length
  const conceptCandidateCount = article.learning.keyConcepts.length
  const retrievalPromptCount = article.learning.retrievalPrompts.length

  const readiness = exerciseReadiness(
    article,
    importantCoveragePercent,
    unsupportedClaimCount,
  )

  const blockers: QualityBlocker[] = []
  const hard = (code: BlockerCode, message: string, refs: string[]) =>
    blockers.push({ code, severity: 'hard', message, refs })
  const soft = (code: BlockerCode, message: string, refs: string[]) =>
    blockers.push({ code, severity: 'soft', message, refs })

  // 1. Important coverage floor (hard) — the PRD's 6%/42% coverage failures.
  if (importantCoveragePercent < threshold) {
    hard(
      'IMPORTANT_COVERAGE_BELOW_THRESHOLD',
      `Important source coverage ${importantCoveragePercent}% is below the ${threshold}% floor for a ${sourceKind} source.`,
      coverage.missingImportantIds,
    )
  }

  // 2. Unsupported claims (hard) — must be 0 for READY_FOR_REVIEW.
  if (unsupportedClaimCount > 0) {
    hard(
      'UNSUPPORTED_CLAIMS_PRESENT',
      `${unsupportedClaimCount} claim(s) are not supported by any source block.`,
      unsupportedClaims.map((c) => c.id),
    )
  }

  // 3. Concept-rich source with zero concepts (hard) — the PRD's "0 concept
  //    candidates" failure on concept-bearing sources.
  if (isConceptRich(blocks) && conceptCandidateCount === 0) {
    hard(
      'NO_CONCEPT_CANDIDATES',
      'The source carries definition/example substance but no key concepts were extracted.',
      [],
    )
  }

  // 4. No retrieval prompts (hard) — an article without retrieval practice is not
  //    a LEARNING article (a core v3 deliverable).
  if (retrievalPromptCount === 0) {
    hard('NO_RETRIEVAL_PROMPTS', 'No retrieval prompts were generated.', [])
  }

  // 5. Low exercise readiness (soft) — advisory; surfaced, never blocking alone.
  if (readiness < LOW_EXERCISE_READINESS) {
    soft(
      'LOW_EXERCISE_READINESS',
      `Exercise readiness ${readiness} is low; the article may not yield strong exercises.`,
      [],
    )
  }

  const hasHardBlocker = blockers.some((b) => b.severity === 'hard')
  const status: V3ArticleStatus = hasHardBlocker
    ? 'BLOCKED'
    : 'READY_FOR_REVIEW'

  return {
    status,
    sourceKind,
    importantCoveragePercent,
    importantCoverageThreshold: threshold,
    unsupportedClaimCount,
    conceptCandidateCount,
    retrievalPromptCount,
    exerciseReadiness: readiness,
    groundedPercent: article.provenance.groundedPercent,
    blockers,
  }
}
