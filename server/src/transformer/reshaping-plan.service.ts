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
 * Block classifications (DET-273) that GROUND each section role. A section's role
 * is only kept when at least one of its cited blocks carries an allowed
 * classification (or, for 'step', is an ordered/LIST block). Roles whose cited
 * blocks do not justify them are stripped (the section is kept) and a warning is
 * appended — deterministic, post-LLM, unit-tested.
 *
 * Notes on the REAL `TransformerBlockClass` enum (MAIN_ARGUMENT, DEFINITION,
 * EXAMPLE, EVIDENCE, METHOD, BACKGROUND, SIDEBAR, CITATION, …): there is NO
 * CAVEAT/DISCLAIMER class — caveats are surfaced by the structure model, not by a
 * block class — so the 'caveat' role is grounded by the presence of a structure
 * model caveat citing one of the section's blocks (checked separately). 'step' is
 * grounded by a LIST source block (block TYPE) or a METHOD classification.
 */
const ROLE_GROUNDING: Record<string, ReadonlySet<string>> = {
  definition: new Set(['DEFINITION']),
  referenceEntry: new Set(['DEFINITION']),
  claim: new Set(['MAIN_ARGUMENT']),
  evidence: new Set(['EVIDENCE']),
  example: new Set(['EXAMPLE']),
  background: new Set(['BACKGROUND']),
  // 'step' also accepts the LIST block TYPE in code (see isRoleGrounded).
  step: new Set(['METHOD']),
  // 'chronology' is an ordering judgement, not a single block class; left
  // ungrounded-by-class on purpose (kept whenever present).
}

/**
 * Reshaping-plan service (DET-252, step 7; genre shape + roles DET-273). LLM via
 * `completeJson(ReshapingPlanSchema)`, then CODE guards:
 *  - every section's cited block id must exist (else throw → article FAILED).
 *  - removedBlocks may only contain removable/noise blocks; a removed block that
 *    is a protected class (or simply not removable) is dropped from removedBlocks,
 *    a warning is added, and the block is kept.
 *  - sectionRole grounding (DET-273): a role whose cited blocks' classifications
 *    do not justify it is STRIPPED (section kept) + a warning. Deterministic.
 *  - procedure ordering (DET-273): when shape === 'procedure', the source LIST
 *    blocks cited by step-role sections must appear in source order across the
 *    plan; a violation is an auditable warning (hard ordering is the fidelity
 *    layer's job — DET-273 fidelity-structural procedure check).
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

    // Guard D (DET-273): sectionRole grounding. Strip any role the section's
    // cited blocks' classifications do not justify (keep the section) + warn.
    const caveatBlockIds = new Set(
      structureModel.caveats.flatMap((c) => c.sourceBlockIds),
    )
    const groundedSections = plan.sections.map((s) =>
      groundSectionRoles(s, byId, caveatBlockIds, warnings),
    )

    // Guard E (DET-273): when shape === 'procedure', the source LIST blocks cited
    // by step-role sections must appear in source order across the plan. A
    // violation is an auditable warning (hard ordering enforcement lives in the
    // fidelity-structural procedure check).
    if (plan.shape === 'procedure') {
      checkProcedureOrder(groundedSections, byId, blocks, warnings)
    }

    return {
      ...plan,
      sections: groundedSections,
      removedBlocks: keptRemovals,
      warnings,
    }
  }
}

/** The minimal block shape the role guards consume (classification + type). */
type ClassifiedBlock = Pick<ClassifiedBlockInput, 'classification' | 'type'>

/** True when a section role is grounded in its cited blocks (DET-273). */
function isRoleGrounded(
  role: NonNullable<ReshapingPlan['sections'][number]['sectionRole']>,
  citedBlocks: ClassifiedBlock[],
  citedIds: string[],
  caveatBlockIds: ReadonlySet<string>,
): boolean {
  // 'caveat' is grounded by a structure-model caveat citing one of the blocks
  // (there is no CAVEAT block class in the enum).
  if (role === 'caveat') return citedIds.some((id) => caveatBlockIds.has(id))
  // 'chronology' is an ordering judgement, not a single block class — kept.
  if (role === 'chronology') return true
  // 'step' is grounded by an ordered/LIST source block OR a METHOD class.
  if (role === 'step') {
    return citedBlocks.some(
      (b) => b.type === 'LIST' || b.classification === 'METHOD',
    )
  }
  const allowed = ROLE_GROUNDING[role]
  if (!allowed) return true
  return citedBlocks.some((b) => allowed.has(b.classification))
}

/**
 * Strip a section's (and its subsections') `sectionRole` when the cited blocks do
 * not ground it; append a warning per stripped role. Returns a new section.
 */
function groundSectionRoles<
  S extends {
    heading: string
    sourceBlockIds: string[]
    sectionRole?: NonNullable<ReshapingPlan['sections'][number]['sectionRole']>
    subsections?: S[]
  },
>(
  section: S,
  byId: ReadonlyMap<string, ClassifiedBlock>,
  caveatBlockIds: ReadonlySet<string>,
  warnings: string[],
): S {
  const citedBlocks = section.sourceBlockIds
    .map((id) => byId.get(id))
    .filter((b): b is ClassifiedBlock => Boolean(b))

  let sectionRole = section.sectionRole
  if (
    sectionRole &&
    !isRoleGrounded(
      sectionRole,
      citedBlocks,
      section.sourceBlockIds,
      caveatBlockIds,
    )
  ) {
    warnings.push(
      `Stripped sectionRole "${sectionRole}" from section "${section.heading}": its cited blocks' classifications do not ground it.`,
    )
    sectionRole = undefined
  }

  const subsections = section.subsections?.map((sub) =>
    groundSectionRoles(sub, byId, caveatBlockIds, warnings),
  )

  const next = { ...section } as S
  if (sectionRole) next.sectionRole = sectionRole
  else delete next.sectionRole
  if (subsections) next.subsections = subsections
  return next
}

/**
 * Procedure ordering warning (DET-273). Collect the LIST source blocks cited by
 * step-role sections (top-level + subsections), in plan order, and verify they
 * appear in non-decreasing SOURCE order. A backward jump means the steps were
 * scrambled relative to the source — append a warning (the fidelity layer blocks).
 */
function checkProcedureOrder(
  sections: ReshapingPlan['sections'],
  byId: ReadonlyMap<string, ClassifiedBlock>,
  blocks: ClassifiedBlockInput[],
  warnings: string[],
): void {
  const sourceOrder = new Map(blocks.map((b, i) => [b.id, i]))
  const stepListIds: string[] = []
  const collect = (s: ReshapingPlan['sections'][number]) => {
    if (s.sectionRole === 'step') {
      for (const id of s.sourceBlockIds) {
        if (byId.get(id)?.type === 'LIST') stepListIds.push(id)
      }
    }
    for (const sub of s.subsections ?? []) collect(sub)
  }
  for (const s of sections) collect(s)

  for (let i = 1; i < stepListIds.length; i++) {
    const prev = sourceOrder.get(stepListIds[i - 1])
    const curr = sourceOrder.get(stepListIds[i])
    if (prev != null && curr != null && curr < prev) {
      warnings.push(
        `Procedure shape: step-role sections cite source LIST blocks out of source order (${stepListIds[i]} precedes ${stepListIds[i - 1]} in the plan but follows it in the source). Steps must stay in source order.`,
      )
      break
    }
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
