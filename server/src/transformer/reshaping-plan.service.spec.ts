import type { AiService } from '../ai/ai.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { ReshapingPlanSchema, type SourceStructureModel } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'

function makeService(planResponse: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(planResponse), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new ReshapingPlanService(ai), complete }
}

const structureModel: SourceStructureModel = {
  claims: [{ text: 'c', sourceBlockIds: ['b1'] }],
  definitions: [],
  examples: [],
  caveats: [],
  terminology: [],
  originalOutline: [],
  noiseDecisions: [],
  uncertainBlockIds: [],
}

/** A structure model whose source carries usable headings (DET-276 guard input). */
const headingedModel: SourceStructureModel = {
  ...structureModel,
  originalOutline: [
    { heading: 'Authentication', level: 2, sourceBlockIds: ['b1'] },
  ],
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'arg',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'def',
    removable: false,
  },
  {
    id: 'b9',
    type: 'PARAGRAPH',
    classification: 'FOOTER',
    text: 'footer',
    removable: true,
  },
]

describe('ReshapingPlanService guards', () => {
  it('keeps a protected block the model tried to remove and warns about it', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: [
        {
          heading: 'H',
          headingSource: 'original',
          headingSourceBlockIds: ['b1'],
          sourceBlockIds: ['b1'],
          allowedTransformations: ['grammar_cleanup'],
        },
      ],
      // Model wrongly tries to remove a DEFINITION block.
      removedBlocks: [
        { blockId: 'b2', reason: 'looks redundant' },
        { blockId: 'b9', reason: 'site footer' },
      ],
      warnings: [],
    })

    const plan = await service.build(headingedModel, blocks)

    // b2 (DEFINITION) is NOT removed; b9 (removable FOOTER) is.
    expect(plan.removedBlocks.map((r) => r.blockId)).toEqual(['b9'])
    expect(plan.warnings.some((w) => w.includes('b2'))).toBe(true)
  })

  it('throws (→ FAILED) when a section references an unknown block id', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'original' },
      sections: [
        {
          heading: 'H',
          headingSource: 'inferred',
          headingInferenceReason: 'no source heading',
          sourceBlockIds: ['ghost'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    await expect(service.build(structureModel, blocks)).rejects.toThrow(
      /unknown block ids/i,
    )
  })

  it('throws when a subsection references an unknown block id', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'original' },
      sections: [
        {
          heading: 'H',
          headingSource: 'original',
          headingSourceBlockIds: ['b1'],
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
          subsections: [
            {
              heading: 'Sub',
              headingSource: 'inferred',
              headingInferenceReason: 'gap fill',
              sourceBlockIds: ['ghost'],
              allowedTransformations: [],
            },
          ],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    await expect(service.build(headingedModel, blocks)).rejects.toThrow(
      /unknown block ids/i,
    )
  })

  it('warns (does not fail) when the source has headings but the plan is all-inferred (DET-276)', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: [
        {
          heading: 'Made up',
          headingSource: 'inferred',
          headingInferenceReason: 'the source heading was unusable noise',
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    const plan = await service.build(headingedModel, blocks)

    expect(
      plan.warnings.some((w) => /every planned heading is inferred/i.test(w)),
    ).toBe(true)
  })

  it('does NOT warn all-inferred when the source has no headings', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: [
        {
          heading: 'Made up',
          headingSource: 'inferred',
          headingInferenceReason: 'transcript has no headings',
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    const plan = await service.build(structureModel, blocks)

    expect(
      plan.warnings.some((w) => /every planned heading is inferred/i.test(w)),
    ).toBe(false)
  })
})

describe('ReshapingPlanSchema heading vocabulary (DET-276)', () => {
  const baseSection = {
    heading: 'H',
    sourceBlockIds: ['b1'],
    allowedTransformations: [],
  }

  it('accepts the v2 vocabulary (original | cleanedOriginal | inferred)', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'cleanedOriginal' },
      sections: [
        { ...baseSection, headingSource: 'original' },
        { ...baseSection, headingSource: 'cleanedOriginal' },
        {
          ...baseSection,
          headingSource: 'inferred',
          headingInferenceReason: 'no source heading',
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects the legacy v1 vocabulary (light_reword / inferred_from_source)', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'light_reword' },
      sections: [{ ...baseSection, headingSource: 'light_reword' }],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  it('requires headingInferenceReason when headingSource is inferred (zod refine)', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'inferred' },
      // inferred heading WITHOUT a reason → must fail the refine.
      sections: [{ ...baseSection, headingSource: 'inferred' }],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  it('does not require a reason for original/cleanedOriginal headings', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'original' },
      sections: [{ ...baseSection, headingSource: 'original' }],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(true)
  })
})
