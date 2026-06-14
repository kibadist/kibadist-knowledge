import { Injectable, Logger } from '@nestjs/common'
import { evaluateQualityGateV3 } from './quality-gate.util'
import { planRegenerationV3 } from './regeneration.util'
import type { V3AssemblyMeta } from './v3-assembly.util'
import { type ArticleJsonV3, isReadableStatusV3 } from './v3-contract'
import {
  type V3GeneratorBlock,
  V3GeneratorService,
} from './v3-generator.service'

/**
 * The v3 article orchestrator (DET-343, "Repair or publish"). Runs the
 * source-grounded generator, reads the quality-gate verdict baked into the
 * assembled article, and — when the article is held back but its hard blockers are
 * all addressable — spends ONE targeted regeneration pass, keeping whichever result
 * the gate rates higher. NEVER throws to the caller for a content problem: a
 * blocked article is a VALID, persistable outcome (its `status` + `qualityReport`
 * tell the reader why it is held back); only an infrastructure failure (LLM error
 * after retries) propagates, which the caller turns into a FAILED row.
 *
 * v3 owns NONE of the v2 columns: it returns a single `ArticleJsonV3` the caller
 * persists into the existing `articleJson` column (discriminated on
 * `schemaVersion: 'v3'` + `mode`), leaving the v2 read path untouched.
 */
@Injectable()
export class ArticlePipelineV3Service {
  private readonly logger = new Logger(ArticlePipelineV3Service.name)

  constructor(private readonly generator: V3GeneratorService) {}

  async run(
    blocks: V3GeneratorBlock[],
    meta: V3AssemblyMeta,
  ): Promise<ArticleJsonV3> {
    const first = await this.generator.generate(blocks, meta)
    if (isReadableStatusV3(first.status)) return first

    const coverageBlocks = blocks.map((b) => ({
      id: b.id,
      classification: b.classification,
      removable: b.removable,
    }))
    const plan = planRegenerationV3(
      evaluateQualityGateV3(first, coverageBlocks),
    )
    if (!plan.shouldRegenerate) return first

    this.logger.log(
      `v3 regeneration: ${plan.targets.map((t) => t.blocker).join(', ')}`,
    )
    const second = await this.generator.regenerate(
      blocks,
      meta,
      plan.targets.map((t) => ({ instruction: t.instruction })),
    )

    // Keep the better article: a readable second pass wins; otherwise the one with
    // the higher important-coverage score (the dominant acceptance metric).
    if (isReadableStatusV3(second.status)) return second
    return second.qualityReport.importantSourceCoverageScore >=
      first.qualityReport.importantSourceCoverageScore
      ? second
      : first
  }
}
