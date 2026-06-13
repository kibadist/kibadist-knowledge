import { buildReshapingPlanPrompt } from './reshaping-plan.prompt'
import type { PromptBlock } from './structure-model.prompt'
import type { ConceptualSegmentation } from './transformer.types'

const blocks: PromptBlock[] = [
  { id: 'b1', type: 'PARAGRAPH', classification: 'DEFINITION', text: 'def' },
  { id: 'b2', type: 'PARAGRAPH', classification: 'MAIN_ARGUMENT', text: 'arg' },
]

const segmentation: ConceptualSegmentation = {
  segments: [
    {
      id: 'seg-0',
      title: 'What a widget is',
      role: 'definition',
      sourceBlockIds: ['b1'],
      importance: 'high',
      summary: 'A widget is defined here.',
      mustPreserveClaims: [],
      suggestedArticlePlacement: 'main_body',
    },
  ],
  unsegmentedBlocks: [],
  warnings: [],
}

describe('buildReshapingPlanPrompt — conceptual segments (DET-347)', () => {
  it('renders the segments so the outline can group from whole learning concepts', () => {
    const { prompt } = buildReshapingPlanPrompt('{}', blocks, [], segmentation)
    expect(prompt).toContain('CONCEPTUAL SEGMENTS')
    expect(prompt).toContain('What a widget is')
    expect(prompt).toContain('role=definition')
    expect(prompt).toContain('blocks=[b1]')
  })

  it('omits the segment block entirely when there is no segmentation', () => {
    const { prompt } = buildReshapingPlanPrompt('{}', blocks, [], null)
    expect(prompt).not.toContain('CONCEPTUAL SEGMENTS')
  })

  it('omits the segment block for an empty segmentation', () => {
    const { prompt } = buildReshapingPlanPrompt('{}', blocks, [], {
      segments: [],
      unsegmentedBlocks: [],
      warnings: [],
    })
    expect(prompt).not.toContain('CONCEPTUAL SEGMENTS')
  })
})
