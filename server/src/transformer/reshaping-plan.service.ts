import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { completeJson } from './llm-json.util'
import { buildReshapingPlanPrompt } from './reshaping-plan.prompt'
import {
  type ReshapingPlan,
  ReshapingPlanSchema,
  type SourceStructureModel,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Protected classes whose blocks may NEVER be removed by the plan — even if the
 * model lists them in removedBlocks. A violation is moved into `warnings` and the
 * block is kept (spec §Pipeline 7 / DET-252).
 */
const PROTECTED_CLASSES = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EXAMPLE',
  'EVIDENCE',
  'UNCERTAIN',
])

/**
 * Reshaping-plan service (DET-252, step 7). LLM via
 * `completeJson(ReshapingPlanSchema)`, then CODE guards:
 *  - every section's cited block id must exist (else throw → article FAILED).
 *  - removedBlocks may only contain removable/noise blocks; a removed block that
 *    is a protected class (or simply not removable) is dropped from removedBlocks,
 *    a warning is added, and the block is kept.
 */
@Injectable()
export class ReshapingPlanService {
  constructor(private readonly ai: AiService) {}

  async build(
    structureModel: SourceStructureModel,
    blocks: ClassifiedBlockInput[],
  ): Promise<ReshapingPlan> {
    const known = new Set(blocks.map((b) => b.id))
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const removableIds = new Set(
      blocks.filter((b) => b.removable).map((b) => b.id),
    )

    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))
    const removable = blocks
      .filter((b) => b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildReshapingPlanPrompt(
      JSON.stringify(structureModel),
      content,
      removable,
    )
    const plan = await completeJson(this.ai, {
      system,
      prompt,
      schema: ReshapingPlanSchema,
      maxTokens: 4000,
    })

    // Guard A: every cited block id (sections, their headings, and one level of
    // subsections) must exist → loud failure.
    const unknown = new Set<string>()
    const checkSection = (s: PlanSectionLike) => {
      for (const id of s.sourceBlockIds) if (!known.has(id)) unknown.add(id)
      for (const id of s.headingSourceBlockIds ?? [])
        if (!known.has(id)) unknown.add(id)
      for (const sub of s.subsections ?? []) checkSection(sub)
    }
    for (const s of plan.sections) checkSection(s)
    if (unknown.size > 0) {
      throw new Error(
        `Reshaping plan references unknown block ids: ${[...unknown].join(', ')}`,
      )
    }

    // Guard C (DET-276): the source has usable headings (the structure model
    // surfaced them in originalOutline) but the plan went ALL-inferred. This may
    // be legitimate (the source headings could be unusable noise), so we do NOT
    // hard-fail — we append an auditable warning so the choice is inspectable.
    const sourceHasHeadings = structureModel.originalOutline.length > 0
    const allInferred =
      plan.sections.length > 0 &&
      plan.sections.every((s) => everyHeadingInferred(s))
    const headingWarnings: string[] = []
    if (sourceHasHeadings && allInferred) {
      headingWarnings.push(
        `Source has ${structureModel.originalOutline.length} heading(s) in its outline, but every planned heading is inferred. Verify the source headings were genuinely unusable.`,
      )
    }

    // Guard B: removedBlocks may only contain removable/noise blocks. Move any
    // violation (protected class, non-removable, or unknown id) into warnings and
    // keep the block.
    const keptRemovals: ReshapingPlan['removedBlocks'] = []
    const warnings = [...plan.warnings, ...headingWarnings]
    for (const r of plan.removedBlocks) {
      const block = byId.get(r.blockId)
      if (!block) {
        warnings.push(
          `Ignored removal of unknown block ${r.blockId}; kept (not in source).`,
        )
        continue
      }
      const isProtected = PROTECTED_CLASSES.has(block.classification)
      if (isProtected || !removableIds.has(r.blockId)) {
        warnings.push(
          `Refused to remove block ${r.blockId} (${block.classification}); it is not removable. Block kept.`,
        )
        continue
      }
      keptRemovals.push(r)
    }

    return { ...plan, removedBlocks: keptRemovals, warnings }
  }
}

/**
 * The shared shape of a plan section and its (one-level) subsections — enough for
 * the recursive id check and the all-inferred test. `subsections` is only present
 * on top-level sections; subsections never nest further.
 */
type PlanSectionLike = {
  headingSource: ReshapingPlan['sections'][number]['headingSource']
  sourceBlockIds: string[]
  headingSourceBlockIds?: string[]
  subsections?: PlanSectionLike[]
}

/** True when this section AND all its subsections have an inferred heading. */
function everyHeadingInferred(s: PlanSectionLike): boolean {
  if (s.headingSource !== 'inferred') return false
  return (s.subsections ?? []).every(everyHeadingInferred)
}
