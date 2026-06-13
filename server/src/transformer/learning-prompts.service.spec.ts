import type { AiService } from '../ai/ai.service'
import { LearningPromptsService } from './learning-prompts.service'
import type { LearningConceptCandidate } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new LearningPromptsService(ai), complete }
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is a set of interacting parts.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'A boundary separates the system from its environment.',
    removable: false,
  },
  {
    id: 'bNoise',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'um, anyway',
    removable: true,
  },
]

const conceptCandidates: LearningConceptCandidate[] = [
  {
    id: 'c1',
    sectionId: 's1',
    label: 'System',
    definition: 'A set of interacting parts.',
    sourceBlockIds: ['b1'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
]

function article(): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'Systems', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 's1',
        heading: 'Systems',
        headingSource: 'original',
        sourceBlockIds: ['b1', 'b2'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'A system is a set of interacting parts.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'co1',
            type: 'callout',
            title: 'Note',
            text: 'Boundaries can be conceptual, not physical.',
            sourceBlockIds: ['b2'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [
      { text: 'A thermostat regulating a room.', sourceBlockIds: ['b2'] },
    ],
    caveats: [],
    originalStructure: [],
  }
}

const input = () => ({
  article: article(),
  blocks,
  conceptCandidates,
  keyClaims: [
    {
      text: 'A boundary separates a system from its environment.',
      sourceBlockIds: ['b2'],
    },
  ],
})

describe('LearningPromptsService', () => {
  it('mints ids and forces every status to its AI-suggested initial value', async () => {
    const { service } = makeService({
      retrievalPrompts: [
        {
          question: 'What is a system?',
          expectedAnswerSourceBlockIds: ['b1'],
          relatedConceptCandidateIds: ['c1'],
          promptType: 'definition',
          difficulty: 'easy',
          // The model is not trusted for status; even if it tried, code wins.
          status: 'user_validated',
        },
      ],
      misconceptions: [
        {
          misconception: 'A system has no boundary.',
          correction: 'A boundary separates it from its environment.',
          sourceBlockIds: ['b2'],
          relatedConceptCandidateIds: ['c1'],
          confidence: 0.8,
          status: 'validated',
        },
      ],
    })
    const out = await service.build(input())
    expect(out.retrievalPrompts).toHaveLength(1)
    expect(out.retrievalPrompts[0].id).toBeTruthy()
    expect(out.retrievalPrompts[0].status).toBe('ai_suggested')
    expect(out.misconceptions).toHaveLength(1)
    expect(out.misconceptions[0].id).toBeTruthy()
    expect(out.misconceptions[0].status).toBe('ai_suggested')
  })

  it('drops retrieval prompts that ground in no real source block', async () => {
    const { service } = makeService({
      retrievalPrompts: [
        {
          question: 'Empty grounding',
          expectedAnswerSourceBlockIds: [],
          relatedConceptCandidateIds: [],
          promptType: 'definition',
          difficulty: 'easy',
        },
        {
          question: 'Ghost grounding',
          expectedAnswerSourceBlockIds: ['ghost'],
          relatedConceptCandidateIds: [],
          promptType: 'mechanism',
          difficulty: 'medium',
        },
        {
          question: 'Good grounding',
          expectedAnswerSourceBlockIds: ['b1', 'ghost'],
          relatedConceptCandidateIds: [],
          promptType: 'definition',
          difficulty: 'easy',
        },
      ],
      misconceptions: [],
    })
    const out = await service.build(input())
    expect(out.retrievalPrompts).toHaveLength(1)
    expect(out.retrievalPrompts[0].question).toBe('Good grounding')
    // The unknown id is stripped; only the real one survives.
    expect(out.retrievalPrompts[0].expectedAnswerSourceBlockIds).toEqual(['b1'])
  })

  it('filters related concept-candidate links to the article’s real candidates', async () => {
    const { service } = makeService({
      retrievalPrompts: [
        {
          question: 'Q',
          expectedAnswerSourceBlockIds: ['b1'],
          relatedConceptCandidateIds: ['c1', 'cGhost'],
          promptType: 'definition',
          difficulty: 'easy',
        },
      ],
      misconceptions: [],
    })
    const out = await service.build(input())
    expect(out.retrievalPrompts[0].relatedConceptCandidateIds).toEqual(['c1'])
  })

  it('keeps ungrounded misconceptions but clamps confidence and stays AI-suggested', async () => {
    const { service } = makeService({
      retrievalPrompts: [],
      misconceptions: [
        {
          misconception: 'General wrong belief',
          correction: 'The right idea',
          sourceBlockIds: ['ghost'],
          relatedConceptCandidateIds: [],
          confidence: 5,
        },
      ],
    })
    const out = await service.build(input())
    expect(out.misconceptions).toHaveLength(1)
    // No real grounding survives → empty, but the item is kept and marked AI.
    expect(out.misconceptions[0].sourceBlockIds).toEqual([])
    expect(out.misconceptions[0].status).toBe('ai_suggested')
    expect(out.misconceptions[0].confidence).toBe(1)
  })

  it('passes concept candidates, claims, examples and callouts into the prompt', async () => {
    const { service, complete } = makeService({
      retrievalPrompts: [],
      misconceptions: [],
    })
    await service.build(input())
    const arg = complete.mock.calls[0][0] as { prompt: string }
    expect(arg.prompt).toContain('A thermostat regulating a room.') // source example
    expect(arg.prompt).toContain('Boundaries can be conceptual') // callout
    expect(arg.prompt).toContain('A boundary separates a system') // key claim
    expect(arg.prompt).toContain('(c1) System') // concept candidate
    // The removable NOISE block is never offered as grounding material.
    expect(arg.prompt).not.toContain('bNoise')
  })
})
