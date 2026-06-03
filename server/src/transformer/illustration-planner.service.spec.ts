import type { AiService } from '../ai/ai.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { SourcePreservingArticle } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new IllustrationPlannerService(ai)
}

const article: SourcePreservingArticle = {
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'original' },
  abstract: [],
  sections: [],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'x',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'METHOD',
    text: 'step 1; step 2',
    removable: false,
  },
]

describe('IllustrationPlannerService', () => {
  it('drops suggestions without valid sourceBlockIds and starts approval pending', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: [], // dropped
        },
        {
          illustrationType: 'decorative_section',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['ghost'], // unknown → dropped
        },
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['b1'], // kept
        },
      ],
    })

    const plan = await service.plan(article, blocks)
    expect(plan.suggestions).toHaveLength(1)
    expect(plan.suggestions[0].sourceBlockIds).toEqual(['b1'])
    expect(plan.suggestions[0].approval).toBe('pending')
    expect(plan.suggestions[0].id).toBeTruthy()
  })

  it('forces high fidelityRisk on a source_based_diagram not backed by a METHOD block', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low', // model says low; code forces high
          reason: 'r',
          sourceBlockIds: ['b1'], // MAIN_ARGUMENT, not METHOD
        },
      ],
    })
    const plan = await service.plan(article, blocks)
    expect(plan.suggestions[0].fidelityRisk).toBe('high')
  })

  it('allows a source_based_diagram backed solely by METHOD blocks to keep its risk', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'medium',
          reason: 'r',
          sourceBlockIds: ['b2'], // METHOD
        },
      ],
    })
    const plan = await service.plan(article, blocks)
    expect(plan.suggestions[0].fidelityRisk).toBe('medium')
  })
})
