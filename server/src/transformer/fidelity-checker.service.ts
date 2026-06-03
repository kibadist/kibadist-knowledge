import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildFidelityPrompt } from './fidelity-checker.prompt'
import { completeJson } from './llm-json.util'
import type { SourceStructureModel } from './schemas'
import { FidelityReportSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  FidelityFinding,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/** Below this score an article is never approved (spec §Pipeline 9). */
const MIN_FIDELITY_SCORE = 95

/**
 * Fidelity-checker service (DET-254, step 9). The LLM report is MERGED with
 * deterministic code checks, then the binding `approved` is recomputed in code:
 *
 *  - paragraphs with no sourceBlockIds OR with unknown block ids → high-severity
 *    `lostInformation` findings (a traceability violation).
 *  - section headings with headingSource 'inferred_from_source' whose section
 *    sourceBlockIds are empty → `unsupportedHeadings` findings.
 *  - `approved = false` if ANY high-severity addedInformation OR high-severity
 *    lostInformation OR fidelityScore < 95 OR any traceability violation.
 *
 * The model's own `approved` is discarded. approved ⇒ FINAL, else ⇒ BLOCKED.
 */
@Injectable()
export class FidelityCheckerService {
  constructor(private readonly ai: AiService) {}

  async check(
    article: SourcePreservingArticle,
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

    return mergeDeterministicChecks(report, article, known)
  }
}

/**
 * Merge the LLM report with deterministic traceability/heading checks and
 * recompute `approved` in code (never trusting the model).
 */
export function mergeDeterministicChecks(
  report: FidelityReport,
  article: SourcePreservingArticle,
  known: ReadonlySet<string>,
): FidelityReport {
  let traceabilityViolation = false
  const lost: FidelityFinding[] = [...report.lostInformation]
  const unsupportedHeadings: FidelityFinding[] = [...report.unsupportedHeadings]

  const checkParagraph = (
    para: { id: string; sourceBlockIds: string[] },
    where: string,
  ) => {
    if (para.sourceBlockIds.length === 0) {
      traceabilityViolation = true
      lost.push({
        severity: 'high',
        description: `Paragraph ${para.id} (${where}) has no sourceBlockIds — untraceable.`,
        articleRef: para.id,
      })
      return
    }
    const unknown = para.sourceBlockIds.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      traceabilityViolation = true
      lost.push({
        severity: 'high',
        description: `Paragraph ${para.id} (${where}) references unknown block ids: ${unknown.join(', ')}.`,
        articleRef: para.id,
        sourceBlockIds: unknown,
      })
    }
  }

  for (const p of article.abstract) checkParagraph(p, 'abstract')
  for (const s of article.sections) {
    for (const p of s.paragraphs) checkParagraph(p, `section ${s.id}`)
    // Inferred headings must be grounded in the section's source blocks.
    if (
      s.headingSource === 'inferred_from_source' &&
      s.sourceBlockIds.length === 0
    ) {
      traceabilityViolation = true
      unsupportedHeadings.push({
        severity: 'high',
        description: `Section "${s.heading}" heading is inferred_from_source but has no section sourceBlockIds.`,
        articleRef: s.id,
      })
    }
  }

  const hasHighAdded = report.addedInformation.some(
    (f) => f.severity === 'high',
  )
  const hasHighLost = lost.some((f) => f.severity === 'high')

  const approved =
    !hasHighAdded &&
    !hasHighLost &&
    !traceabilityViolation &&
    report.fidelityScore >= MIN_FIDELITY_SCORE

  return {
    ...report,
    approved,
    lostInformation: lost,
    unsupportedHeadings,
  }
}
