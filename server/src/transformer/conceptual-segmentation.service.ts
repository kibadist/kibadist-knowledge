import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildSegmentationPrompt } from './conceptual-segmentation.prompt'
import {
  findUnknownSegmentBlockIds,
  findUnreasonedHighImportanceBlocks,
  orderSegmentsBySource,
  repairSegmentation,
} from './conceptual-segmentation.util'
import { completeJson } from './llm-json.util'
import type { SourceStructureModel } from './schemas'
import { type SegmentationLlm, SegmentationLlmSchema } from './schemas'
import type { PromptBlock } from './structure-model.prompt'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ConceptualSegmentation, SourceSegment } from './transformer.types'

/**
 * Conceptual-segmentation service (DET-347, between structure model and reshaping
 * plan). ONE LLM call via `completeJson(SegmentationLlmSchema)`, then CODE guards
 * that mirror the structure-model / reshaping-plan house style:
 *  - traceability: every cited block id must exist (the `repair` hook prunes
 *    invented ids first; `assertKnownIds` then fails loudly if any survive).
 *  - ordering: segments are sorted into source-reading order so the teaching arc
 *    is preserved (a later outline stage owns any audited reorder).
 *  - ids: `seg-N` is minted IN CODE in reading order — never prompt-trusted.
 *  - coverage: any HIGH-IMPORTANCE block the model left out of every segment AND
 *    forgot to record gets a synthesized `unsegmentedBlocks` reason + a warning,
 *    so the persisted artifact never carries an unreasoned high-importance block.
 *
 * The segment→block mapping it produces is persisted by the article pipeline and
 * consumed by the reshaping plan, so the outline builds sections from whole
 * learning concepts instead of isolated blocks.
 */
@Injectable()
export class ConceptualSegmentationService {
  constructor(private readonly ai: AiService) {}

  async segment(
    structureModel: SourceStructureModel,
    blocks: ClassifiedBlockInput[],
  ): Promise<ConceptualSegmentation> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks.filter((b) => !b.removable).map(toPromptBlock)
    const removable = blocks.filter((b) => b.removable).map(toPromptBlock)

    const { system, prompt } = buildSegmentationPrompt(
      JSON.stringify(structureModel),
      content,
      removable,
    )
    const llm = await completeJson(this.ai, {
      system,
      prompt,
      schema: SegmentationLlmSchema,
      // Drop references the source can't back BEFORE validating, so a single
      // hallucinated id doesn't FAIL an otherwise-faithful segmentation. A segment
      // left with no real provenance is dropped; assertKnownIds guards what stays.
      repair: (parsed) => repairSegmentation(parsed, known),
      maxTokens: 4000,
    })

    return this.finalize(llm, blocks, known)
  }

  /**
   * Turn the validated LLM segmentation into the persisted artifact: re-check
   * traceability loudly, order segments by source, mint stable ids, and reconcile
   * coverage so every high-importance block is segmented or reasoned.
   */
  private finalize(
    llm: SegmentationLlm,
    blocks: ClassifiedBlockInput[],
    known: ReadonlySet<string>,
  ): ConceptualSegmentation {
    // Mint ids in code, then order by source: a temporary id keeps the type whole
    // while we sort, and the FINAL ids are re-stamped in reading order below.
    const ordered = orderSegmentsBySource(
      llm.segments.map((s, i) => ({ ...s, id: `seg-${i}` })),
      blocks,
    ).map((s, i) => ({ ...s, id: `seg-${i}` }))

    const segmentation: ConceptualSegmentation = {
      segments: ordered as SourceSegment[],
      unsegmentedBlocks: [...llm.unsegmentedBlocks],
      warnings: [],
    }

    // Loud traceability guard — repair should have removed every invented id, so
    // a survivor is real breakage. Matches the structure model's assertKnownIds.
    const unknown = findUnknownSegmentBlockIds(segmentation, known)
    if (unknown.length > 0) {
      throw new Error(
        `Segmentation references unknown block ids: ${unknown.join(', ')}`,
      )
    }

    // Coverage reconciliation (DET-347 acceptance): every high-importance block
    // the model dropped without a reason gets a synthesized one + a warning, so
    // no high-importance block is ever left unsegmented without a reason.
    const orphaned = findUnreasonedHighImportanceBlocks(blocks, segmentation)
    if (orphaned.length > 0) {
      const byId = new Map(blocks.map((b) => [b.id, b]))
      for (const id of orphaned) {
        const block = byId.get(id)
        const cls = block?.classification ?? 'UNKNOWN'
        segmentation.unsegmentedBlocks.push({
          blockId: id,
          reason: `high-importance ${cls} block left unsegmented by the model; recorded for the coverage/fidelity audit`,
        })
        segmentation.warnings.push(
          `High-importance block ${id} (${cls}) was not placed in any segment; recorded under unsegmentedBlocks for the coverage audit.`,
        )
      }
    }

    return segmentation
  }
}

function toPromptBlock(b: ClassifiedBlockInput): PromptBlock {
  return {
    id: b.id,
    type: b.type,
    classification: b.classification,
    text: b.text,
    headingLevel: b.headingLevel,
  }
}
