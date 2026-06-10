import type { IllustrationPlan, LearningLayer } from './schemas'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
  CoverageReport,
  FidelityFinding,
  FidelityReport,
} from './transformer.types'

/**
 * Aggregated article quality report (DET-320). PURE, NO LLM — a deterministic
 * rollup of the artifacts the pipeline already persists (fidelity report,
 * coverage report, the v2 article, and the optional illustration/learning
 * lanes) into the single signal the spec's §12 quality report asks for. The
 * same inputs always produce the same report; nothing here re-judges the
 * article, it only counts and normalizes what the upstream checks found.
 *
 * Scores are 0–1 (two decimals). `figureSuggestionCount` and
 * `conceptCandidateCount` reflect the lanes AS OF the rollup — illustrations
 * are planned in the background after finalize (DET-319), so a report computed
 * at finalize legitimately reads 0 there.
 */
export interface ArticleQualityReport {
  /** Source coverage (coverage report's percent, normalized to 0–1). */
  sourceCoverageScore: number
  /** Fraction of article blocks carrying non-empty source provenance. */
  citationCoverageScore: number
  /** Unsupported additions the fidelity check found (added info, unsupported
   *  headings, unsupported examples). Strict mode wants this at zero. */
  unsupportedClaimCount: number
  /** Blocks the generator marked high fidelity-risk — the review queue. */
  lowConfidenceBlockCount: number
  tableCount: number
  figureSuggestionCount: number
  conceptCandidateCount: number
  /** How ready the article is to seed the Exercise tab (0–1 heuristic). */
  exerciseReadinessScore: number
  /** Human-readable reasons a reviewer should look closer (capped). */
  reviewerWarnings: string[]
}

const MAX_WARNINGS = 10

export interface BuildQualityReportArgs {
  article: ArticleJsonV2
  fidelity: FidelityReport
  coverage: CoverageReport
  illustrationPlan?: IllustrationPlan | null
  learningLayer?: LearningLayer | null
}

export function buildQualityReport(
  args: BuildQualityReportArgs,
): ArticleQualityReport {
  const { article, fidelity, coverage, illustrationPlan, learningLayer } = args

  const blocks = allBlocks(article)
  const citedBlocks = blocks.filter((b) => b.sourceBlockIds.length > 0).length
  const citationCoverageScore =
    blocks.length === 0 ? 0 : round2(citedBlocks / blocks.length)

  const sourceCoverageScore = round2(
    Math.min(Math.max(coverage.coveragePercent, 0), 100) / 100,
  )

  const unsupportedClaimCount =
    fidelity.addedInformation.length +
    fidelity.unsupportedHeadings.length +
    fidelity.unsupportedExamples.length

  const lowConfidenceBlockCount = blocks.filter(
    (b) => b.fidelityRisk === 'high',
  ).length

  const tableCount = blocks.filter((b) => b.type === 'table').length
  const figureSuggestionCount = illustrationPlan?.suggestions.length ?? 0
  const conceptCandidateCount =
    (learningLayer?.concepts.length ?? 0) +
    (learningLayer?.conceptCandidates?.length ?? 0)

  // Exercise readiness: a weighted presence check over the ingredients the
  // Exercise tab seeds from. Deliberately simple and inspectable — each clause
  // is one capability the downstream modes need.
  let readiness = 0
  if (article.sections.length > 0) readiness += 0.25
  if (article.keyTerms.length > 0) readiness += 0.2
  if (article.sourceExamples.length + article.caveats.length > 0)
    readiness += 0.15
  if ((article.readingAids?.highlights?.length ?? 0) > 0) readiness += 0.15
  if (coverage.coveragePercent >= 80) readiness += 0.15
  if (unsupportedClaimCount === 0) readiness += 0.1
  const exerciseReadinessScore = round2(readiness)

  return {
    sourceCoverageScore,
    citationCoverageScore,
    unsupportedClaimCount,
    lowConfidenceBlockCount,
    tableCount,
    figureSuggestionCount,
    conceptCandidateCount,
    exerciseReadinessScore,
    reviewerWarnings: buildWarnings(fidelity, coverage, {
      unsupportedClaimCount,
      lowConfidenceBlockCount,
    }),
  }
}

/** Every v2 block, sections + one level of subsections, in reading order. */
function allBlocks(article: ArticleJsonV2): ArticleBlock[] {
  const out: ArticleBlock[] = []
  const visit = (section: ArticleSectionV2) => {
    out.push(...section.blocks)
    for (const sub of section.subsections ?? []) visit(sub)
  }
  for (const section of article.sections) visit(section)
  return out
}

function buildWarnings(
  fidelity: FidelityReport,
  coverage: CoverageReport,
  counts: { unsupportedClaimCount: number; lowConfidenceBlockCount: number },
): string[] {
  const warnings: string[] = []

  // High-severity fidelity findings lead, in the report's own group order so
  // the output is deterministic.
  const groups: [string, FidelityFinding[]][] = [
    ['Added information', fidelity.addedInformation],
    ['Lost information', fidelity.lostInformation],
    ['Meaning change', fidelity.meaningChanges],
    ['Unsupported heading', fidelity.unsupportedHeadings],
    ['Missing caveat', fidelity.missingCaveats],
    ['Unsupported example', fidelity.unsupportedExamples],
  ]
  for (const [label, findings] of groups) {
    for (const f of findings) {
      if (f.severity !== 'high') continue
      warnings.push(`${label}: ${f.description}`)
    }
  }

  if (coverage.coveragePercent < 80) {
    warnings.push(
      `Source coverage is ${Math.round(coverage.coveragePercent)}% — major source material may be unrepresented`,
    )
  }
  if (counts.unsupportedClaimCount > 0) {
    warnings.push(
      `${counts.unsupportedClaimCount} unsupported addition(s) flagged by the fidelity check`,
    )
  }
  if (counts.lowConfidenceBlockCount > 0) {
    warnings.push(
      `${counts.lowConfidenceBlockCount} block(s) carry high fidelity risk`,
    )
  }

  return warnings.slice(0, MAX_WARNINGS)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
