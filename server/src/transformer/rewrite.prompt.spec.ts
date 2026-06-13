import { buildRewritePrompt } from './rewrite.prompt'
import type {
  LearningOutline,
  OutlineSection,
  SourceSegment,
} from './rewrite.types'

/**
 * Prompt-builder spec (DET-349). The system prompt must fix the allowed/disallowed
 * transformation boundary and the SourceTrace contract; the user prompt must expose
 * ONLY the section's own source blocks (with their ids + roles) so the model can
 * cite nothing it wasn't shown.
 */

const segments: SourceSegment[] = [
  {
    id: 'seg1',
    summary: 'why rate limiting exists',
    blocks: [
      {
        id: 'b2',
        role: 'core_claim',
        text: 'Rate limiting protects shared capacity.',
      },
      { id: 'b3', role: 'analogy', text: 'It is like a turnstile.' },
    ],
  },
  {
    id: 'seg2',
    blocks: [
      { id: 'b9', role: 'background', text: 'Quotas reset each minute.' },
    ],
  },
]

const outline: LearningOutline = {
  title: 'Rate limiting',
  sourceKind: 'structured_web_article',
  shape: 'concept_explainer',
  sections: [
    {
      id: 'o1',
      heading: 'Why rate limiting exists',
      headingSource: 'inferred',
      intent: 'Motivate the need',
      segmentIds: ['seg1'],
    },
  ],
}

const segmentById = new Map(segments.map((s) => [s.id, s]))

describe('buildRewritePrompt', () => {
  const { system, prompt } = buildRewritePrompt(
    outline,
    outline.sections[0] as OutlineSection,
    segmentById,
  )

  it('states the allowed and disallowed transformation boundary', () => {
    expect(system).toMatch(/ALLOWED transformations/)
    expect(system).toMatch(/DISALLOWED by default/)
    expect(system).toMatch(/invented analogies/)
    expect(system).toMatch(/transformationType/)
    expect(system).toMatch(/source_analogy.*role is "analogy"/s)
  })

  it('exposes only the section’s own blocks with ids and roles', () => {
    expect(prompt).toContain('[b2] (core_claim) Rate limiting protects')
    expect(prompt).toContain('[b3] (analogy) It is like a turnstile.')
    expect(prompt).toContain('SECTION TO WRITE: Why rate limiting exists')
    expect(prompt).toContain('LEARNING INTENT: Motivate the need')
    expect(prompt).toContain('SOURCE KIND: structured_web_article')
    // A block from another section's segment must NOT leak in.
    expect(prompt).not.toContain('b9')
    expect(prompt).not.toContain('Quotas reset')
  })

  it('includes subsection blocks and headings when the section nests', () => {
    const nested: OutlineSection = {
      id: 'o2',
      heading: 'Parent',
      headingSource: 'inferred',
      segmentIds: ['seg1'],
      subsections: [
        {
          id: 'o2a',
          heading: 'Resets',
          headingSource: 'inferred',
          segmentIds: ['seg2'],
        },
      ],
    }
    const { prompt: nestedPrompt } = buildRewritePrompt(
      outline,
      nested,
      segmentById,
    )
    expect(nestedPrompt).toContain('## planned subsection: Resets')
    expect(nestedPrompt).toContain(
      '[b9] (background) Quotas reset each minute.',
    )
  })
})
