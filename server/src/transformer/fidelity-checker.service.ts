import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { toArticleV2 } from './article-compat.util'
import { buildFidelityPrompt } from './fidelity-checker.prompt'
import { validateClusters } from './fidelity-clusters.util'
import {
  checkDuplicateRendering,
  checkEndMatterTraceability,
  checkQuoteAttribution,
  checkUnsupportedHighlights,
} from './fidelity-structural.util'
import { completeJson } from './llm-json.util'
import type { SourceStructureModel } from './schemas'
import { FidelityReportSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  FidelityFinding,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/** Below this score an article is never approved (spec §Pipeline 9). */
const MIN_FIDELITY_SCORE = 95

/**
 * Fidelity-checker service (DET-254 / DET-281, step 9). The LLM report is MERGED
 * with deterministic code checks, then the binding `approved` is recomputed in
 * code:
 *
 *  - blocks with no sourceBlockIds OR with unknown block ids → high-severity
 *    `lostInformation` findings (a traceability violation).
 *  - section headings with headingSource 'inferred' whose section
 *    sourceBlockIds are empty → `unsupportedHeadings` findings.
 *  - FULL v2 traversal traceability (every typed block / subsection / abstract /
 *    keyTerm / sourceExample / caveat / readingAids highlight) → high-severity
 *    `structuralFindings` + traceability violation (DET-281).
 *  - quote attribution loss (heuristic, medium), duplicate full rendering
 *    (medium; high for a duplicated caveat), unsupported highlights (high),
 *    claim/caveat + claim/evidence cluster SEPARATION (high), chronology
 *    inversion (high `emphasisChanges`) — DET-281.
 *  - `approved = false` if ANY high-severity addedInformation, lostInformation,
 *    meaningChanges, emphasisChanges OR structuralFindings, OR fidelityScore
 *    < 95, OR any traceability violation.
 *
 * The model's own `approved` is discarded. approved ⇒ FINAL, else ⇒ BLOCKED.
 */
@Injectable()
export class FidelityCheckerService {
  constructor(private readonly ai: AiService) {}

  async check(
    article: SourcePreservingArticle | ArticleJsonV2,
    structureModel: SourceStructureModel,
    blocks: ClassifiedBlockInput[],
  ): Promise<FidelityReport> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildFidelityPrompt(
      JSON.stringify(structureModel),
      JSON.stringify(article),
      content,
    )
    const report = await completeJson(this.ai, {
      system,
      prompt,
      schema: FidelityReportSchema,
      maxTokens: 4000,
    })

    return mergeDeterministicChecks(report, article, known, {
      structureModel,
      blocks,
    })
  }
}

/**
 * Optional deterministic-check inputs (DET-281). When the structure model and
 * classified blocks (with text) are supplied, the merge additionally runs the
 * structural + cluster checks (quote attribution, duplicate rendering, cluster
 * separation, chronology). Omitting them keeps the original traceability/heading
 * merge — the 3-arg call site stays valid.
 */
export interface DeterministicCheckInputs {
  structureModel?: SourceStructureModel
  blocks?: ClassifiedBlockInput[]
}

/**
 * Merge the LLM report with deterministic traceability / heading / structural
 * checks (DET-281) and recompute `approved` in code (never trusting the model).
 */
export function mergeDeterministicChecks(
  report: FidelityReport,
  input: SourcePreservingArticle | ArticleJsonV2,
  known: ReadonlySet<string>,
  inputs: DeterministicCheckInputs = {},
): FidelityReport {
  // Adapt v1 → v2 so the traversal is uniform; idempotent for native v2.
  const article = toArticleV2(input)
  let traceabilityViolation = false
  const lost: FidelityFinding[] = [...report.lostInformation]
  const unsupportedHeadings: FidelityFinding[] = [...report.unsupportedHeadings]
  const emphasisChanges: FidelityFinding[] = [...report.emphasisChanges]
  const structuralFindings: FidelityFinding[] = [...report.structuralFindings]

  const checkFragment = (
    fragment: { id: string; sourceBlockIds: string[] },
    where: string,
  ) => {
    if (fragment.sourceBlockIds.length === 0) {
      traceabilityViolation = true
      lost.push({
        severity: 'high',
        description: `Block ${fragment.id} (${where}) has no sourceBlockIds — untraceable.`,
        articleRef: fragment.id,
      })
      return
    }
    const unknown = fragment.sourceBlockIds.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      traceabilityViolation = true
      lost.push({
        severity: 'high',
        description: `Block ${fragment.id} (${where}) references unknown block ids: ${unknown.join(', ')}.`,
        articleRef: fragment.id,
        sourceBlockIds: unknown,
      })
    }
  }

  const checkSection = (s: ArticleSectionV2) => {
    for (const b of s.blocks) checkFragment(b, `section ${s.id}`)
    // Inferred headings must be grounded in the section's source blocks.
    if (s.headingSource === 'inferred' && s.sourceBlockIds.length === 0) {
      traceabilityViolation = true
      unsupportedHeadings.push({
        severity: 'high',
        description: `Section "${s.heading}" heading is inferred but has no section sourceBlockIds.`,
        articleRef: s.id,
      })
    }
    for (const sub of s.subsections ?? []) checkSection(sub)
  }

  for (const p of article.abstract) checkFragment(p, 'abstract')
  for (const s of article.sections) checkSection(s)

  // --- DET-281 structural checks --------------------------------------------
  // End-matter + reading-aid traceability beyond the abstract/blocks/headings
  // already checked above (subtitle, keyTerms, sourceExamples, caveats,
  // highlights). Any untraceable fragment is a high structuralFinding + a
  // traceability violation. `checkFullTraceability` re-walks blocks/abstract
  // too, so we add only the structuralFindings it surfaces for the END-MATTER
  // surfaces, avoiding double-counting the block/abstract findings already in
  // `lost`. (The util is exercised whole by its own unit spec.)
  const endMatterTrace = checkEndMatterTraceability(article, known)
  structuralFindings.push(...endMatterTrace.structuralFindings)
  if (endMatterTrace.traceabilityViolation) traceabilityViolation = true

  // Unsupported reading-aid highlights (high, blocking).
  structuralFindings.push(...checkUnsupportedHighlights(article, known))

  // Duplicate full rendering (medium; high for a duplicated caveat).
  const dup = checkDuplicateRendering(article)
  structuralFindings.push(...dup.findings)

  // Cluster + attribution checks need block text + the structure model.
  if (inputs.blocks)
    structuralFindings.push(...checkQuoteAttribution(article, inputs.blocks))
  if (inputs.structureModel && inputs.blocks) {
    const clusters = validateClusters(
      article,
      inputs.structureModel,
      inputs.blocks,
    )
    structuralFindings.push(...clusters.structuralFindings)
    emphasisChanges.push(...clusters.emphasisChanges)
  }

  const hasHigh = (findings: FidelityFinding[]) =>
    findings.some((f) => f.severity === 'high')

  const approved =
    !hasHigh(report.addedInformation) &&
    !hasHigh(lost) &&
    !hasHigh(report.meaningChanges) &&
    !hasHigh(emphasisChanges) &&
    !hasHigh(structuralFindings) &&
    !traceabilityViolation &&
    report.fidelityScore >= MIN_FIDELITY_SCORE

  return {
    ...report,
    approved,
    lostInformation: lost,
    unsupportedHeadings,
    emphasisChanges,
    structuralFindings,
  }
}
