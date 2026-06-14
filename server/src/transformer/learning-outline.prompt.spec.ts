import { buildLearningOutlinePrompt } from './learning-outline.prompt'
import type { SourceSegment } from './learning-outline.types'
import type { PromptBlock } from './structure-model.prompt'

const segments: SourceSegment[] = [
  {
    id: 'seg1',
    kind: 'content',
    blockIds: ['h1', 'b1'],
    headingText: 'What Is a System',
    dominantClassification: 'CORE',
  },
  {
    id: 'seg2',
    kind: 'references',
    blockIds: ['h2', 'b2'],
    headingText: 'References',
    dominantClassification: 'CITATION',
  },
]

const blocks: PromptBlock[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is…',
  },
]

describe('buildLearningOutlinePrompt', () => {
  it('includes shape-specific guidance for concept_explainer', () => {
    const { prompt } = buildLearningOutlinePrompt(
      'encyclopedia',
      'concept_explainer',
      segments,
      blocks,
    )
    expect(prompt).toMatch(/concept_explainer/)
    expect(prompt).toMatch(/definition → boundaries → types → mechanism/)
  })

  it('includes shape-specific guidance for research_digest', () => {
    const { prompt } = buildLearningOutlinePrompt(
      'research_paper',
      'research_digest',
      segments,
      blocks,
    )
    expect(prompt).toMatch(/question → method → evidence → results/)
  })

  it('lists the segments with their furniture kind and instructs demotion', () => {
    const { system, prompt } = buildLearningOutlinePrompt(
      'encyclopedia',
      'concept_explainer',
      segments,
      blocks,
    )
    expect(prompt).toMatch(/\[seg2\] kind=references/)
    expect(prompt).toMatch(/Demote references\/bibliography\/external-links/i)
    expect(system).toMatch(/SOURCE FURNITURE → SOURCE NOTES/)
  })
})
