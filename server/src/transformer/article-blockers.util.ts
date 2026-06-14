import type { SourceKind } from './source-diagnosis.types'
import type {
  ArticleBlocker,
  ConceptualSegmentation,
  CoverageReport,
  FidelityFinding,
  FidelityReport,
  Severity,
} from './transformer.types'

/**
 * Article blocker derivation (DET-356). Pure, deterministic, NO LLM. Distils the
 * fidelity + coverage reports (plus the concept/segmentation context) into the
 * small set of repairable `ArticleBlocker`s that explain WHY the gate rejected an
 * article, so a targeted repair strategy can be looked up per reason.
 *
 * This is the inverse of the gate: `FidelityCheckerService` decides `approved`
 * from high-severity findings + score + traceability; here we group those same
 * signals (and the coverage / concept / transcript signals the gate does not own)
 * under the four product-level reasons the repair handlers key on.
 */

/** Below this coverage percent the article is treated as low-coverage. */
export const LOW_COVERAGE_PERCENT = 85

/**
 * A concept-rich source must mint at least this many concept candidates; fewer
 * (including zero) on such a source is a `missing_concepts` blocker. Sources that
 * are not concept-rich (e.g. raw notes) are never blocked on this.
 */
export const MIN_CONCEPT_CANDIDATES = 3

/** Source kinds whose teachable material we expect to yield concept candidates. */
const CONCEPT_RICH_KINDS: ReadonlySet<SourceKind> = new Set([
  'transcript_lesson',
  'structured_web_article',
  'research_paper',
  'documentation',
])

/** Whether a source kind is concept-rich (so `missing_concepts` can apply). */
export function isConceptRichSource(kind: SourceKind): boolean {
  return CONCEPT_RICH_KINDS.has(kind)
}

export interface BlockerDerivationInput {
  fidelity: FidelityReport
  coverage: CoverageReport
  /**
   * Concept candidates extracted for the article. `null` means extraction never
   * ran (a degraded path), which on a concept-rich source is itself a blocker.
   */
  conceptCandidateCount: number | null
  sourceKind: SourceKind
  /** The conceptual segmentation, or `null` when it degraded/failed. */
  segmentation: ConceptualSegmentation | null
  /**
   * High-importance source blocks left unrepresented by the article. Precomputed
   * by the caller (segmentation high-importance blocks ∩ unrepresented), so a
   * dropped key idea is a low-coverage blocker even when the percent looks fine.
   */
  highImportanceUnrepresented?: string[]
}

/**
 * High-importance source blocks the article left unrepresented (DET-356). The
 * intersection of every high-importance segment's blocks with the coverage
 * report's unrepresented set — a dropped key idea, even when the percent reads
 * well. Returns [] when there is no segmentation. Pure.
 */
export function highImportanceUnrepresented(
  segmentation: ConceptualSegmentation | null,
  coverage: CoverageReport,
): string[] {
  if (!segmentation) return []
  const unrepresented = new Set(coverage.unrepresentedBlockIds)
  const ids = new Set<string>()
  for (const segment of segmentation.segments) {
    if (segment.importance !== 'high') continue
    for (const id of segment.sourceBlockIds) {
      if (unrepresented.has(id)) ids.add(id)
    }
  }
  return [...ids]
}

/** Worst severity across a finding list, defaulting to `low` when empty. */
function worstSeverity(findings: FidelityFinding[]): Severity {
  if (findings.some((f) => f.severity === 'high')) return 'high'
  if (findings.some((f) => f.severity === 'medium')) return 'medium'
  return 'low'
}

/** Pick the higher of two severities. */
function maxSeverity(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { low: 0, medium: 1, high: 2 }
  return rank[a] >= rank[b] ? a : b
}

/** Collect the article refs / source block ids carried by a finding list. */
function collectEvidence(findings: FidelityFinding[]): {
  articleRefs: string[]
  sourceBlockIds: string[]
} {
  const articleRefs = new Set<string>()
  const sourceBlockIds = new Set<string>()
  for (const f of findings) {
    if (f.articleRef) articleRefs.add(f.articleRef)
    for (const id of f.sourceBlockIds ?? []) sourceBlockIds.add(id)
  }
  return { articleRefs: [...articleRefs], sourceBlockIds: [...sourceBlockIds] }
}

/**
 * Derive the repairable blockers for a (typically BLOCKED) article. An approved
 * article normally yields an empty list; a blocked one yields one entry per
 * implicated reason, each with the evidence the targeted handler needs.
 */
export function deriveBlockers(
  input: BlockerDerivationInput,
): ArticleBlocker[] {
  const blockers: ArticleBlocker[] = []
  const { fidelity, coverage, segmentation, sourceKind } = input
  const highImportanceUnrepresented = input.highImportanceUnrepresented ?? []

  // --- low_coverage --------------------------------------------------------
  // The article silently dropped source material: either the overall coverage
  // percent is below the floor, or a high-importance block was left out (which is
  // a miss even when the percent reads well). Evidence is the unrepresented set.
  const lowPercent = coverage.coveragePercent < LOW_COVERAGE_PERCENT
  if (lowPercent || highImportanceUnrepresented.length > 0) {
    const sourceBlockIds =
      highImportanceUnrepresented.length > 0
        ? highImportanceUnrepresented
        : coverage.unrepresentedBlockIds
    blockers.push({
      reason: 'low_coverage',
      severity: highImportanceUnrepresented.length > 0 ? 'high' : 'medium',
      explanation:
        highImportanceUnrepresented.length > 0
          ? `${highImportanceUnrepresented.length} high-importance source block(s) are unrepresented in the article.`
          : `Coverage is ${coverage.coveragePercent}% (below the ${LOW_COVERAGE_PERCENT}% floor); ${coverage.unrepresentedBlockIds.length} source block(s) are unrepresented.`,
      evidence: {
        sourceBlockIds,
        count: coverage.unrepresentedBlockIds.length,
      },
    })
  }

  // --- unsupported_claims --------------------------------------------------
  // Content the source does not support: added information, unsupported examples
  // / headings, and ungrounded source-grounded extras (structural findings). Any
  // high-severity one of these blocks the gate; medium ones are still repairable.
  const unsupportedFindings: FidelityFinding[] = [
    ...fidelity.addedInformation,
    ...fidelity.unsupportedExamples,
    ...fidelity.unsupportedHeadings,
    ...fidelity.structuralFindings.filter((f) =>
      /ungrounded|unsupported|untraceable|no sourceBlockIds/i.test(
        f.description,
      ),
    ),
  ]
  if (unsupportedFindings.length > 0) {
    const evidence = collectEvidence(unsupportedFindings)
    blockers.push({
      reason: 'unsupported_claims',
      severity: worstSeverity(unsupportedFindings),
      explanation: `${unsupportedFindings.length} article item(s) make claims the source does not support.`,
      evidence: {
        articleRefs: evidence.articleRefs,
        sourceBlockIds: evidence.sourceBlockIds,
        count: unsupportedFindings.length,
      },
    })
  }

  // --- missing_concepts ----------------------------------------------------
  // A concept-rich source that finalizes with too few (or zero) concept
  // candidates can't drive the learning loop. `null` = extraction never ran.
  if (isConceptRichSource(sourceKind)) {
    const count = input.conceptCandidateCount
    if (count === null || count < MIN_CONCEPT_CANDIDATES) {
      blockers.push({
        reason: 'missing_concepts',
        severity: count === null || count === 0 ? 'high' : 'medium',
        explanation:
          count === null
            ? `Concept extraction did not run for a ${sourceKind} source (expected at least ${MIN_CONCEPT_CANDIDATES} candidates).`
            : `Only ${count} concept candidate(s) for a ${sourceKind} source (expected at least ${MIN_CONCEPT_CANDIDATES}).`,
        evidence: { count: count ?? 0 },
      })
    }
  }

  // --- poor_transcript_coherence -------------------------------------------
  // Transcript lessons fragment into incoherent prose when segmentation degrades
  // or the teaching arc gets reordered/separated. Signals: no segmentation,
  // segmentation warnings, unsegmented blocks, or cluster-separation / chronology
  // structural+emphasis findings.
  if (sourceKind === 'transcript_lesson') {
    const coherenceFindings: FidelityFinding[] = [
      ...fidelity.emphasisChanges,
      ...fidelity.structuralFindings.filter((f) =>
        /separat|cluster|chronolog|reorder|order/i.test(f.description),
      ),
    ]
    const noSegmentation = segmentation === null
    const segmentationWarnings = segmentation?.warnings ?? []
    const unsegmented = segmentation?.unsegmentedBlocks ?? []
    if (
      noSegmentation ||
      segmentationWarnings.length > 0 ||
      unsegmented.length > 0 ||
      coherenceFindings.length > 0
    ) {
      const evidence = collectEvidence(coherenceFindings)
      const severity = noSegmentation
        ? 'high'
        : maxSeverity(worstSeverity(coherenceFindings), 'medium')
      const reasons: string[] = []
      if (noSegmentation)
        reasons.push('no conceptual segmentation was produced')
      if (segmentationWarnings.length > 0)
        reasons.push(`${segmentationWarnings.length} segmentation warning(s)`)
      if (unsegmented.length > 0)
        reasons.push(`${unsegmented.length} unsegmented block(s)`)
      if (coherenceFindings.length > 0)
        reasons.push(
          `${coherenceFindings.length} ordering/cluster fidelity finding(s)`,
        )
      blockers.push({
        reason: 'poor_transcript_coherence',
        severity,
        explanation: `Transcript lesson lacks a coherent teaching arc: ${reasons.join('; ')}.`,
        evidence: {
          articleRefs: evidence.articleRefs,
          sourceBlockIds: [
            ...evidence.sourceBlockIds,
            ...unsegmented.map((u) => u.blockId),
          ],
        },
      })
    }
  }

  return blockers
}
