import { buildSegmentationPrompt } from './conceptual-segmentation.prompt'
import type { PromptBlock } from './structure-model.prompt'

const content: PromptBlock[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A definition of the topic.',
  },
  {
    id: 'b2',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'Some heading',
    headingLevel: 2,
  },
]

const removable: PromptBlock[] = [
  {
    id: 'b9',
    type: 'PARAGRAPH',
    classification: 'FOOTER',
    text: 'site footer',
  },
]

describe('buildSegmentationPrompt', () => {
  it('embeds the structure model JSON and every content block id', () => {
    const { prompt } = buildSegmentationPrompt(
      JSON.stringify({ claims: [] }),
      content,
      removable,
    )
    expect(prompt).toContain('STRUCTURE MODEL')
    expect(prompt).toContain('[b1] (PARAGRAPH/DEFINITION)')
    // Heading depth is surfaced as level=N so the model can group by hierarchy.
    expect(prompt).toContain('level=2')
    expect(prompt).toContain('[b9]')
  })

  it('teaches the segment role vocabulary and the coverage rule', () => {
    const { system } = buildSegmentationPrompt('{}', content, removable)
    for (const role of [
      'orientation',
      'definition',
      'mechanism',
      'distinction',
      'example',
      'analogy',
      'history',
      'application',
      'caveat',
      'summary',
    ]) {
      expect(system).toContain(role)
    }
    // The teaching-intent rule + the high-importance coverage guard are present.
    expect(system).toMatch(/TEACHING INTENT/)
    expect(system).toMatch(/unsegmentedBlocks/)
  })

  it('renders "(none)" when there are no removable blocks', () => {
    const { prompt } = buildSegmentationPrompt('{}', content, [])
    expect(prompt).toContain('(none)')
  })
})
