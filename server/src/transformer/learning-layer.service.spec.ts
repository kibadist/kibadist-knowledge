import type { AiService } from '../ai/ai.service'
import { LearningLayerService } from './learning-layer.service'
import type { ClassifiedBlockInput } from './structure-model.service'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new LearningLayerService(ai)
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'x',
    removable: false,
  },
]

describe('LearningLayerService', () => {
  it('starts every concept validationStatus at pending and mints ids', async () => {
    const service = makeService({
      concepts: [{ label: 'L', definition: 'D', sourceBlockIds: ['b1'] }],
      retrievalPrompts: [{ prompt: 'Q?', sourceBlockIds: ['b1'] }],
    })
    const layer = await service.build(blocks)
    expect(layer.concepts).toHaveLength(1)
    expect(layer.concepts[0].validationStatus).toBe('pending')
    expect(layer.concepts[0].id).toBeTruthy()
    expect(layer.retrievalPrompts[0].id).toBeTruthy()
  })

  it('drops concepts and prompts without valid sourceBlockIds', async () => {
    const service = makeService({
      concepts: [
        { label: 'L', definition: 'D', sourceBlockIds: [] },
        { label: 'L2', definition: 'D2', sourceBlockIds: ['ghost'] },
        { label: 'L3', definition: 'D3', sourceBlockIds: ['b1'] },
      ],
      retrievalPrompts: [{ prompt: 'Q?', sourceBlockIds: ['ghost'] }],
    })
    const layer = await service.build(blocks)
    expect(layer.concepts).toHaveLength(1)
    expect(layer.concepts[0].label).toBe('L3')
    expect(layer.retrievalPrompts).toHaveLength(0)
  })
})
