import type { AiService } from '../ai/ai.service'
import { RewriteService } from './rewrite.service'
import type { LearningOutline, SourceSegment } from './rewrite.types'

/**
 * Service spec (DET-349). Drives the rewrite end-to-end with a stubbed AiService:
 * one mocked reply per top-level section. Confirms the service scopes each call to
 * its own segments, finalizes through the pure guards, and drops a section that
 * empties out.
 */

const segments: SourceSegment[] = [
  {
    id: 'seg1',
    blocks: [
      { id: 'b1', role: 'core_claim', text: 'The onboarding flow shipped.' },
      { id: 'b2', role: 'example', text: 'Activation rose fifteen percent.' },
    ],
  },
  {
    id: 'seg2',
    blocks: [{ id: 'b3', role: 'core_claim', text: 'Billing is next.' }],
  },
]

const outline: LearningOutline = {
  title: 'Quarterly update',
  sourceKind: 'transcript_lesson',
  shape: 'lesson_flow',
  sections: [
    {
      id: 'o1',
      heading: 'What shipped',
      headingSource: 'inferred',
      segmentIds: ['seg1'],
    },
    {
      id: 'o2',
      heading: "What's next",
      headingSource: 'inferred',
      segmentIds: ['seg2'],
    },
  ],
}

function reply(body: unknown) {
  return { text: JSON.stringify(body), model: 'stub' }
}

describe('RewriteService.rewrite', () => {
  it('rewrites each section, mints ids, and traces every paragraph', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce(
        reply({
          heading: 'What shipped',
          headingSource: 'inferred',
          paragraphs: [
            {
              text: 'The team shipped a new onboarding flow this quarter.',
              sourceBlockIds: ['b1'],
              transformationType: 'speech_cleanup',
              fidelityRisk: 'low',
              confidence: 0.9,
            },
            {
              text: 'Activation rose about fifteen percent afterward.',
              sourceBlockIds: ['b2'],
              transformationType: 'source_grounded_rewrite',
              fidelityRisk: 'low',
              confidence: 0.8,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          heading: "What's next",
          headingSource: 'inferred',
          paragraphs: [
            {
              text: 'Billing improvements are planned next.',
              sourceBlockIds: ['b3'],
              transformationType: 'source_grounded_rewrite',
              fidelityRisk: 'low',
              confidence: 0.7,
            },
          ],
        }),
      )
    const ai = { complete } as unknown as AiService

    const sections = await new RewriteService(ai).rewrite(outline, segments)

    expect(sections).toHaveLength(2)
    expect(sections[0].id).toBe('s0')
    expect(sections[0].paragraphs.map((p) => p.id)).toEqual(['s0-p0', 's0-p1'])
    // Every paragraph carries source block ids + a transformation type.
    for (const section of sections) {
      for (const p of section.paragraphs) {
        expect(p.trace.sourceBlockIds.length).toBeGreaterThan(0)
        expect(p.trace.transformationType).toBeTruthy()
      }
    }
    // The second call is scoped to seg2's blocks only.
    const secondPrompt = complete.mock.calls[1][0].prompt as string
    expect(secondPrompt).toContain('[b3]')
    expect(secondPrompt).not.toContain('[b1]')
  })

  it('drops a section whose rewrite is entirely unsupported', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce(
        reply({
          heading: 'What shipped',
          headingSource: 'inferred',
          paragraphs: [
            {
              text: 'Grounded.',
              sourceBlockIds: ['b1'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
              confidence: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          heading: "What's next",
          headingSource: 'inferred',
          paragraphs: [
            {
              text: 'Hallucinated — cites a block this section never had.',
              sourceBlockIds: ['ghost'],
              transformationType: 'source_grounded_inference',
              fidelityRisk: 'low',
              confidence: 0.4,
            },
          ],
        }),
      )
    const ai = { complete } as unknown as AiService

    const sections = await new RewriteService(ai).rewrite(outline, segments)

    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe('What shipped')
  })
})
