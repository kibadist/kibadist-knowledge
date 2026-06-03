import type { AiService } from '../ai/ai.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import type { SourceStructureModel } from './schemas'
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
      titleProposal: { text: 'T', source: 'inferred_from_source' },
      sections: [
        {
          heading: 'H',
          headingSource: 'original',
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

    const plan = await service.build(structureModel, blocks)

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
          headingSource: 'original',
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
})
