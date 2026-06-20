import { buildReshapingCompletionPrompt } from './reshaping-completeness.prompt'

describe('buildReshapingCompletionPrompt', () => {
  it('numbers the existing sections and lists every dropped block id', () => {
    const { system, prompt } = buildReshapingCompletionPrompt(
      [
        { heading: 'Intro', sourceBlockIds: ['b1'] },
        { heading: 'Body', sourceBlockIds: ['b2', 'b3'] },
      ],
      [{ id: 'b7', type: 'PARAGRAPH', classification: 'EVIDENCE', text: 'x' }],
    )
    expect(system).toMatch(/sectionIndex/)
    expect(prompt).toContain('[0] "Intro"')
    expect(prompt).toContain('[1] "Body"')
    expect(prompt).toContain('[b7]')
  })
})
