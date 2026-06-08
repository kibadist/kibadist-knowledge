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

  it('drops a section with no traceable reference and builds from the valid ones', async () => {
    // One real section, one whose only citation is invented → the invented
    // section is pruned before Guard A rather than failing the whole article.
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'original' },
      sections: [
        {
          heading: 'Keep',
          headingSource: 'original',
          headingSourceBlockIds: ['b1'],
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
        {
          heading: 'Drop',
          headingSource: 'inferred',
          headingInferenceReason: 'invented',
          sourceBlockIds: ['ghost'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    const plan = await service.build(structureModel, blocks)
    expect(plan.sections.map((s) => s.heading)).toEqual(['Keep'])
  })

  it('still FAILS when no section has a traceable reference (nothing to build)', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'original' },
      sections: [
        {
          heading: 'H',
          headingSource: 'inferred',
          headingInferenceReason: 'invented',
          sourceBlockIds: ['ghost'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })

    // Every section is pruned → the schema's sections.min(1) rejects the empty
    // plan, so the article still fails loudly when nothing is traceable.
    await expect(service.build(structureModel, blocks)).rejects.toThrow()
  })

  it('drops an untraceable subsection, keeping its parent section', async () => {
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
              heading: 'Keep sub',
              headingSource: 'original',
              headingSourceBlockIds: ['b2'],
              sourceBlockIds: ['b2'],
              allowedTransformations: [],
            },
            {
              heading: 'Drop sub',
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

    const plan = await service.build(headingedModel, blocks)
    expect(plan.sections).toHaveLength(1)
    expect(plan.sections[0].subsections?.map((s) => s.heading)).toEqual([
      'Keep sub',
    ])
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

describe('ReshapingPlanService genre shape + roles (DET-273)', () => {
  // A source with a MAIN_ARGUMENT, a DEFINITION and an ordered LIST so the role
  // grounding guard has real classifications/types to check against.
  const genreBlocks: ClassifiedBlockInput[] = [
    {
      id: 'b1',
      type: 'PARAGRAPH',
      classification: 'MAIN_ARGUMENT',
      text: 'the claim',
      removable: false,
    },
    {
      id: 'b2',
      type: 'PARAGRAPH',
      classification: 'DEFINITION',
      text: 'the definition',
      removable: false,
    },
    {
      id: 'b3',
      type: 'LIST',
      classification: 'METHOD',
      text: '1. first\n2. second',
      removable: false,
    },
    {
      id: 'b4',
      type: 'LIST',
      classification: 'METHOD',
      text: '3. third\n4. fourth',
      removable: false,
    },
  ]

  it("defaults shape to 'hybrid' when the model omits it", async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: [
        {
          heading: 'H',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.shape).toBe('hybrid')
  })

  it('keeps the model shape when valid', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      shape: 'argument',
      sections: [
        {
          heading: 'Claim',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'claim',
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.shape).toBe('argument')
    // 'claim' cites a MAIN_ARGUMENT block → the role is kept.
    expect(plan.sections[0].sectionRole).toBe('claim')
  })

  it('strips a step role whose section cites no LIST/METHOD block + warns', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      shape: 'procedure',
      sections: [
        {
          // 'step' but cites only a DEFINITION block — not grounded → stripped.
          heading: 'Not really steps',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b2'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.sections[0].sectionRole).toBeUndefined()
    expect(
      plan.warnings.some((w) => /Stripped sectionRole "step"/.test(w)),
    ).toBe(true)
  })

  it('keeps a step role that cites a LIST block', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      shape: 'procedure',
      sections: [
        {
          heading: 'Steps',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b3'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.sections[0].sectionRole).toBe('step')
  })

  it('warns when procedure step sections cite source LIST blocks out of source order', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      shape: 'procedure',
      // b4 (later in source) cited BEFORE b3 (earlier) → out of source order.
      sections: [
        {
          heading: 'Steps part two',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b4'],
          allowedTransformations: [],
        },
        {
          heading: 'Steps part one',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b3'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.warnings.some((w) => /out of source order/.test(w))).toBe(true)
  })

  it('does NOT warn when procedure step sections keep source LIST order', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      shape: 'procedure',
      sections: [
        {
          heading: 'Steps part one',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b3'],
          allowedTransformations: [],
        },
        {
          heading: 'Steps part two',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'step',
          sourceBlockIds: ['b4'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, genreBlocks)
    expect(plan.warnings.some((w) => /out of source order/.test(w))).toBe(false)
  })
})

describe('ReshapingPlanSchema genre shape (DET-273)', () => {
  const baseSection = {
    heading: 'H',
    headingSource: 'original' as const,
    sourceBlockIds: ['b1'],
    allowedTransformations: [],
  }

  it('rejects an unknown shape value', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'original' },
      shape: 'listicle',
      sections: [baseSection],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  it("defaults shape to 'hybrid' when omitted", () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'original' },
      sections: [baseSection],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.shape).toBe('hybrid')
  })

  it('rejects an illegal sectionRole', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'original' },
      shape: 'argument',
      sections: [{ ...baseSection, sectionRole: 'thesis' }],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(false)
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

describe('ReshapingPlanService audited reorder (DET-275)', () => {
  // b1 at source pos 0, b2 at source pos 1; reversing the two sections moves one.
  const invertedSections = [
    {
      heading: 'Definition first',
      headingSource: 'inferred' as const,
      headingInferenceReason: 'no heading',
      sourceBlockIds: ['b2'],
      allowedTransformations: [],
    },
    {
      heading: 'Argument second',
      headingSource: 'inferred' as const,
      headingInferenceReason: 'no heading',
      sourceBlockIds: ['b1'],
      allowedTransformations: [],
    },
  ]

  it('warns when a section moves but the move is not recorded in reorderings', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: invertedSections,
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, blocks)
    expect(plan.warnings.some((w) => /unaudited reorder/i.test(w))).toBe(true)
  })

  it('does NOT warn when the move is recorded in reorderings', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: invertedSections,
      removedBlocks: [],
      warnings: [],
      // The section anchored on b2 reads before the b1 section → b2 jumped up.
      reorderings: [
        {
          sourceBlockId: 'b2',
          fromIndex: 1,
          toIndex: 0,
          reason: 'definition reads better first',
          risk: 'low',
        },
      ],
    })
    const plan = await service.build(structureModel, blocks)
    expect(plan.warnings.some((w) => /unaudited reorder/i.test(w))).toBe(false)
    expect(plan.reorderings).toHaveLength(1)
  })

  it('defaults reorderings to [] when the plan omits them', async () => {
    const { service } = makeService({
      titleProposal: { text: 'T', source: 'inferred' },
      sections: [
        {
          heading: 'H',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sourceBlockIds: ['b1'],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    const plan = await service.build(structureModel, blocks)
    expect(plan.reorderings).toEqual([])
  })
})
