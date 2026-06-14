/**
 * Article quality gates + blocker status model (DET-355).
 *
 * GOAL. Prevent incomplete or unsupported articles from reaching
 * READY_FOR_REVIEW. After the fidelity review (step 9) produces a fidelity report
 * + coverage report and the learning lane mints concept candidates, this module
 * grades those signals against a set of thresholds and decides a single
 * `ArticleStatus`: a held-back `BLOCKED_*` (or `NEEDS_REGENERATION`) state, or the
 * gate-passed `READY_FOR_REVIEW`.
 *
 * WHY A SEPARATE LAYER. The fidelity checker already recomputes its own binding
 * `approved` (no high-severity finding + score ≥ 95 + no traceability violation),
 * which is a SOURCE-FIDELITY gate. DET-355 adds LEARNING-READINESS gates on top —
 * important-source coverage by article shape, unsupported-claim count, concept
 * coverage — and, crucially, attaches an EXPLAINABLE reason list (each pointing at
 * the quality-report field that tripped it) so the reader can see exactly why an
 * article is held back and what to fix. The fidelity `approved` flag is folded in
 * as the `fidelity` gate.
 *
 * PURE + DETERMINISTIC. `evaluateQualityGates` is a pure function — no LLM, no I/O
 * — so it is exhaustively unit-tested without network (the module convention). The
 * pipeline wires it in after the fidelity check (see `article-pipeline.service`).
 *
 * CONTRACT MIRRORING. The status union, blocker codes and `ArticleQualityReportV3`
 * shape mirror the web reader contract in `web/src/lib/article-v3.ts` 1:1 — the v3
 * reader renders `qualityReport.blockerReasons` / `regenerationHints` straight from
 * the persisted article JSON. Keep both sides in sync (CLAUDE.md §Shared contracts).
 */

import type { SourceKind } from './source-diagnosis.types'

// --- Status + blocker vocabulary --------------------------------------------

/**
 * The article lifecycle status. Anything `BLOCKED_*` (or `NEEDS_REGENERATION`) is
 * a held-back state the reader renders with its blocker reasons + regeneration
 * hints; `READY_FOR_REVIEW` / `FINAL` are the readable, gate-passed states.
 * `DRAFT` / `GENERATING` are pre-terminal. Mirrors `ArticleStatusV3` (web).
 */
export type ArticleStatus =
  | 'DRAFT'
  | 'GENERATING'
  | 'NEEDS_REGENERATION'
  | 'BLOCKED_LOW_COVERAGE'
  | 'BLOCKED_UNSUPPORTED_CLAIMS'
  | 'BLOCKED_MISSING_CONCEPTS'
  | 'BLOCKED_FIDELITY'
  | 'READY_FOR_REVIEW'
  | 'FINAL'

/** Machine-readable blocker codes that map onto the quality-gate failures. */
export type ArticleBlockerCode =
  | 'low_coverage'
  | 'unsupported_claims'
  | 'missing_concepts'
  | 'fidelity'
  | 'lost_information'
  | 'weak_exercise_readiness'

/** A single reason an article is held back, with a pointer to its report entry. */
export interface ArticleBlockerReason {
  code: ArticleBlockerCode
  message: string
  /**
   * Points at a quality-report field (a key of `ArticleQualityReportV3`) so the
   * reader can deep-link the offending metric (DET-355 acceptance criterion 5).
   */
  qualityReportRef?: keyof ArticleQualityReportV3 | string
  /** Source blocks implicated by the failure, when the signal carries them. */
  sourceBlockIds?: string[]
}

// --- Thresholds --------------------------------------------------------------

/**
 * The tunable quality gate thresholds. Defaults below are the DET-355 spec
 * defaults; a caller may override any subset (e.g. per-workspace policy later).
 */
export interface ArticleQualityThresholds {
  /** Min important-source coverage for transcript lessons (speech → lesson). */
  minTranscriptImportantCoverageScore: number
  /** Min important-source coverage for structured-article explainers. */
  minStructuredArticleImportantCoverageScore: number
  /** Max tolerated unsupported (added, ungrounded) claims. */
  maxUnsupportedClaimCount: number
  /** Min concept candidates a concept-rich article must surface. */
  minConceptCandidateCount: number
  /** Min exercise-readiness score (gate skipped when no score is available). */
  minExerciseReadinessScore: number
  /** Max tolerated high-severity lost-information findings. */
  maxHighSeverityLostInfoItems: number
}

/** DET-355 default thresholds. */
export const DEFAULT_ARTICLE_QUALITY_THRESHOLDS: ArticleQualityThresholds = {
  minTranscriptImportantCoverageScore: 0.8,
  minStructuredArticleImportantCoverageScore: 0.7,
  maxUnsupportedClaimCount: 0,
  minConceptCandidateCount: 3,
  minExerciseReadinessScore: 0.7,
  maxHighSeverityLostInfoItems: 0,
}

// --- Quality report (mirrors web `ArticleQualityReportV3`) -------------------

/**
 * The v3 quality report attached to the persisted article JSON. It grades SOURCE
 * FIDELITY (grounding/coverage/lost-info) AND LEARNING QUALITY (concepts, prompts,
 * readability) and carries the gate decision (`blockerReasons` + `regenerationHints`).
 * All scores are in [0, 1]; counts are non-negative integers. Mirrors the web
 * `ArticleQualityReportV3` field-for-field so the reader renders it directly.
 */
export interface ArticleQualityReportV3 {
  sourceCoverageScore: number
  importantSourceCoverageScore: number
  citationCoverageScore: number
  unsupportedClaimCount: number
  highSeverityLostInfoCount: number
  conceptCandidateCount: number
  keyClaimCount: number
  retrievalPromptCount: number
  tableCount: number
  calloutCount: number
  exerciseReadinessScore: number
  articleReadabilityScore: number
  provenanceCompletenessScore: number
  reviewerWarnings: string[]
  blockerReasons: ArticleBlockerReason[]
  regenerationHints: string[]
}

// --- Gate input + result -----------------------------------------------------

/**
 * The normalized signals the gate consumes. Built by the pipeline from the
 * fidelity report, coverage report, source diagnosis and learning lane. Keeping
 * this a flat value object (not the raw reports) keeps the gate pure + trivially
 * testable, and decouples it from the v2/v3 article shapes.
 */
export interface ArticleGateInput {
  /** Detected source kind — selects the coverage threshold (transcript vs structured). */
  sourceKind: SourceKind
  /** Whether the source is concept-rich (the missing-concepts gate only applies then). */
  conceptRich: boolean
  /** The fidelity checker's binding `approved` flag (its own source-fidelity gate). */
  fidelityApproved: boolean
  /** Fraction of HIGH-importance source blocks represented in the article, [0, 1]. */
  importantSourceCoverageScore: number
  /** Count of unsupported (added, ungrounded) claims (high-severity addedInformation). */
  unsupportedClaimCount: number
  /** Count of concept candidates the article surfaced. */
  conceptCandidateCount: number
  /** Count of high-severity lost-information findings. */
  highSeverityLostInfoCount: number
  /**
   * Exercise-readiness score, [0, 1]. OPTIONAL: when undefined the
   * weak-exercise-readiness gate is skipped (there is no exercise-generation lane
   * yet, so an absent score must not block every article). The threshold + gate
   * logic exist and activate the moment a real score is wired in.
   */
  exerciseReadinessScore?: number
}

/** The gate decision: a single status plus the explainable reasons + hints. */
export interface ArticleGateResult {
  status: ArticleStatus
  blockerReasons: ArticleBlockerReason[]
  regenerationHints: string[]
}

// --- Shape → threshold mapping ----------------------------------------------

/**
 * Which important-coverage threshold a source kind is held to. Transcript lessons
 * (speech reshaped into a lesson) are held to the stricter 0.8 — a dropped span of
 * spoken teaching is a real loss; structured web articles / papers / docs are held
 * to 0.7. `unknown` / `raw_notes` use the looser structured bar (conservative — we
 * never invented structure for them, so we don't over-penalise coverage).
 */
export function minImportantCoverageForKind(
  sourceKind: SourceKind,
  thresholds: ArticleQualityThresholds,
): number {
  return sourceKind === 'transcript_lesson'
    ? thresholds.minTranscriptImportantCoverageScore
    : thresholds.minStructuredArticleImportantCoverageScore
}

// --- Important-coverage helper ----------------------------------------------

/** Minimal block projection the important-coverage computation needs. */
export interface ImportanceBlock {
  id: string
  /** True when the block was classified HIGH importance (DET-346 role classifier). */
  important: boolean
}

/**
 * Fraction of HIGH-importance source blocks that are represented in the article,
 * in [0, 1]. A source with NO high-importance blocks scores 1 (nothing important
 * to miss) — the coverage gate must never block a source that has no important
 * material to cover.
 */
export function importantCoverageScore(
  blocks: ImportanceBlock[],
  representedBlockIds: Iterable<string>,
): number {
  const important = blocks.filter((b) => b.important)
  if (important.length === 0) return 1
  const represented = new Set(representedBlockIds)
  const covered = important.filter((b) => represented.has(b.id)).length
  return covered / important.length
}

// --- The gate ----------------------------------------------------------------

/**
 * Priority order for resolving the single `status` when several gates fail at
 * once. The banner always lists EVERY blocker reason; this only chooses which
 * `BLOCKED_*` label heads the banner. Integrity gates (unsupported claims, broken
 * fidelity, lost info) rank above the learning-readiness gates.
 */
const STATUS_PRIORITY: ArticleBlockerCode[] = [
  'unsupported_claims',
  'fidelity',
  'lost_information',
  'low_coverage',
  'missing_concepts',
  'weak_exercise_readiness',
]

/** Map a blocker code onto the held-back status it produces. */
const BLOCKED_STATUS_FOR_CODE: Record<ArticleBlockerCode, ArticleStatus> = {
  unsupported_claims: 'BLOCKED_UNSUPPORTED_CLAIMS',
  low_coverage: 'BLOCKED_LOW_COVERAGE',
  missing_concepts: 'BLOCKED_MISSING_CONCEPTS',
  // The remaining integrity/readiness gates fold into the general fidelity block —
  // the status union exposes no dedicated label for them, but their distinct
  // blocker reason still surfaces in the banner.
  fidelity: 'BLOCKED_FIDELITY',
  lost_information: 'BLOCKED_FIDELITY',
  weak_exercise_readiness: 'BLOCKED_FIDELITY',
}

/** A short, actionable fix hint per blocker code (shown under "How to fix it"). */
const REGENERATION_HINT_FOR_CODE: Record<ArticleBlockerCode, string> = {
  low_coverage:
    'Regenerate with wider source coverage — keep more of the important source material in the article.',
  unsupported_claims:
    'Remove or ground every claim the source does not support before review.',
  missing_concepts:
    'Re-extract concepts — a concept-rich source should yield at least the minimum number of concept candidates.',
  fidelity:
    'Regenerate the article — the fidelity review found changes that alter or break the source meaning.',
  lost_information:
    'Restore the high-importance information the reshape dropped, then re-run the fidelity check.',
  weak_exercise_readiness:
    'Strengthen the retrieval prompts and concept coverage so the article is exercise-ready.',
}

/**
 * Evaluate the DET-355 quality gates over the normalized signals and produce the
 * blocker status, the explainable reasons (each pointing at a quality-report
 * field), and the regeneration hints.
 *
 *  - `unsupported_claims`  — unsupportedClaimCount > maxUnsupportedClaimCount.
 *  - `fidelity`            — the fidelity checker did not approve the article.
 *  - `lost_information`    — highSeverityLostInfoCount > maxHighSeverityLostInfoItems.
 *  - `low_coverage`        — importantSourceCoverageScore < the shape's threshold.
 *  - `missing_concepts`    — conceptRich AND conceptCandidateCount < min.
 *  - `weak_exercise_readiness` — only when a readiness score is supplied AND below min.
 *
 * No failures ⇒ `READY_FOR_REVIEW`. The fidelity `approved` flag is folded in so a
 * single status reflects BOTH source-fidelity and learning-readiness gates.
 */
export function evaluateQualityGates(
  input: ArticleGateInput,
  thresholds: ArticleQualityThresholds = DEFAULT_ARTICLE_QUALITY_THRESHOLDS,
): ArticleGateResult {
  const blockerReasons: ArticleBlockerReason[] = []

  // 1. Unsupported claims — the hardest gate (AC: cannot enter review with any).
  if (input.unsupportedClaimCount > thresholds.maxUnsupportedClaimCount) {
    blockerReasons.push({
      code: 'unsupported_claims',
      message: `${input.unsupportedClaimCount} unsupported claim(s) not grounded in the source (max ${thresholds.maxUnsupportedClaimCount}).`,
      qualityReportRef: 'unsupportedClaimCount',
    })
  }

  // 2. Source fidelity — fold in the fidelity checker's own binding gate.
  if (!input.fidelityApproved) {
    blockerReasons.push({
      code: 'fidelity',
      message: 'The fidelity review did not approve this article.',
      qualityReportRef: 'highSeverityLostInfoCount',
    })
  }

  // 3. Lost information — high-severity dropped source material.
  if (
    input.highSeverityLostInfoCount > thresholds.maxHighSeverityLostInfoItems
  ) {
    blockerReasons.push({
      code: 'lost_information',
      message: `${input.highSeverityLostInfoCount} high-severity lost-information finding(s) (max ${thresholds.maxHighSeverityLostInfoItems}).`,
      qualityReportRef: 'highSeverityLostInfoCount',
    })
  }

  // 4. Important-source coverage — shape-dependent threshold.
  const minCoverage = minImportantCoverageForKind(input.sourceKind, thresholds)
  if (input.importantSourceCoverageScore < minCoverage) {
    blockerReasons.push({
      code: 'low_coverage',
      message: `Important-source coverage ${formatPct(input.importantSourceCoverageScore)} is below the required ${formatPct(minCoverage)} for ${input.sourceKind}.`,
      qualityReportRef: 'importantSourceCoverageScore',
    })
  }

  // 5. Missing concepts — only for concept-rich sources.
  if (
    input.conceptRich &&
    input.conceptCandidateCount < thresholds.minConceptCandidateCount
  ) {
    blockerReasons.push({
      code: 'missing_concepts',
      message: `Only ${input.conceptCandidateCount} concept candidate(s) for a concept-rich source (need ${thresholds.minConceptCandidateCount}).`,
      qualityReportRef: 'conceptCandidateCount',
    })
  }

  // 6. Exercise readiness — skipped when no score is supplied (see input doc).
  if (
    input.exerciseReadinessScore !== undefined &&
    input.exerciseReadinessScore < thresholds.minExerciseReadinessScore
  ) {
    blockerReasons.push({
      code: 'weak_exercise_readiness',
      message: `Exercise-readiness ${formatPct(input.exerciseReadinessScore)} is below the required ${formatPct(thresholds.minExerciseReadinessScore)}.`,
      qualityReportRef: 'exerciseReadinessScore',
    })
  }

  return {
    status: resolveStatus(blockerReasons),
    blockerReasons,
    regenerationHints: blockerReasons.map(
      (r) => REGENERATION_HINT_FOR_CODE[r.code],
    ),
  }
}

/**
 * Resolve the single banner status from the blocker reasons. No blockers ⇒
 * READY_FOR_REVIEW; otherwise the highest-priority failing gate's status.
 */
function resolveStatus(reasons: ArticleBlockerReason[]): ArticleStatus {
  if (reasons.length === 0) return 'READY_FOR_REVIEW'
  const codes = new Set(reasons.map((r) => r.code))
  for (const code of STATUS_PRIORITY) {
    if (codes.has(code)) return BLOCKED_STATUS_FOR_CODE[code]
  }
  // Unreachable (every code is in STATUS_PRIORITY) — fall back defensively.
  return 'BLOCKED_FIDELITY'
}

/** A held-back status: a blocker gate or a pending regeneration (mirrors web). */
export function isBlockedStatus(status: ArticleStatus): boolean {
  return status.startsWith('BLOCKED_') || status === 'NEEDS_REGENERATION'
}

// --- Quality report assembly -------------------------------------------------

/**
 * The measured signals (beyond the gate input) needed to fill the full
 * `ArticleQualityReportV3`. The gate only needs a few of these to DECIDE; the
 * report carries the rest so the reader's quality panel has the complete picture.
 * All scores are clamped to [0, 1] and counts floored at 0 by the assembler.
 */
export interface ArticleQualityReportSignals {
  sourceCoverageScore: number
  importantSourceCoverageScore: number
  citationCoverageScore: number
  unsupportedClaimCount: number
  highSeverityLostInfoCount: number
  conceptCandidateCount: number
  keyClaimCount: number
  retrievalPromptCount: number
  tableCount: number
  calloutCount: number
  /** Optional — defaults to 0 (no exercise-readiness measurement yet). */
  exerciseReadinessScore?: number
  articleReadabilityScore: number
  provenanceCompletenessScore: number
  /** Non-gate warnings surfaced by upstream lanes (deduped, kept as-is). */
  reviewerWarnings?: string[]
}

/**
 * Compose the full `ArticleQualityReportV3` from the measured signals + the gate
 * decision. Pure: scores are clamped to [0, 1], counts floored at 0, so a slightly
 * out-of-range upstream value can never produce an invalid report.
 */
export function buildArticleQualityReport(
  signals: ArticleQualityReportSignals,
  gate: ArticleGateResult,
): ArticleQualityReportV3 {
  return {
    sourceCoverageScore: clamp01(signals.sourceCoverageScore),
    importantSourceCoverageScore: clamp01(signals.importantSourceCoverageScore),
    citationCoverageScore: clamp01(signals.citationCoverageScore),
    unsupportedClaimCount: floor0(signals.unsupportedClaimCount),
    highSeverityLostInfoCount: floor0(signals.highSeverityLostInfoCount),
    conceptCandidateCount: floor0(signals.conceptCandidateCount),
    keyClaimCount: floor0(signals.keyClaimCount),
    retrievalPromptCount: floor0(signals.retrievalPromptCount),
    tableCount: floor0(signals.tableCount),
    calloutCount: floor0(signals.calloutCount),
    exerciseReadinessScore: clamp01(signals.exerciseReadinessScore ?? 0),
    articleReadabilityScore: clamp01(signals.articleReadabilityScore),
    provenanceCompletenessScore: clamp01(signals.provenanceCompletenessScore),
    reviewerWarnings: signals.reviewerWarnings ?? [],
    blockerReasons: gate.blockerReasons,
    regenerationHints: gate.regenerationHints,
  }
}

/** Clamp a number into [0, 1]; non-finite ⇒ 0. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Floor a count at 0; non-finite ⇒ 0. Rounds to the nearest integer. */
function floor0(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

/** Format a [0,1] score as a whole-percent string for human-readable messages. */
function formatPct(score: number): string {
  return `${Math.round(score * 100)}%`
}
