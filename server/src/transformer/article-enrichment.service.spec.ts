import type { AiService } from '../ai/ai.service'
import { ArticleEnrichmentService } from './article-enrichment.service'
import type { ArticleJsonV2 } from './transformer.types'

/**
 * Enrichment spec (DET-319). The ONE non-source-grounded stage. We mock the LLM
 * and assert the CODE guarantees: the validated shape is returned, `keyFacts` is
 * sliced to a few, and the model's context is built from title/abstract/headings.
 */
function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new ArticleEnrichmentService(ai), complete }
}

const article = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Spaced repetition', source: 'original' },
  abstract: [
    {
      id: 'p-abs-1',
      text: 'A technique that schedules reviews at expanding intervals.',
      sourceBlockIds: ['b1'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [{ heading: 'Why it works', blocks: [] }],
} as unknown as ArticleJsonV2

describe('ArticleEnrichmentService', () => {
  it('returns the validated enrichment and feeds the title to the model', async () => {
    const { service, complete } = makeService({
      pronunciation: '/speɪst ˌrɛpɪˈtɪʃən/',
      partOfSpeech: 'noun',
      etymology: 'From Latin repetitio.',
      classification: 'Technique · Cognitive psychology',
      keyFacts: [{ label: 'Field', value: 'Memory' }],
    })

    const result = await service.build(article)

    expect(result.classification).toBe('Technique · Cognitive psychology')
    expect(result.keyFacts).toHaveLength(1)
    // The model is prompted with the article's headword for subject identification.
    const userPrompt = complete.mock.calls[0][0].prompt as string
    expect(userPrompt).toContain('Spaced repetition')
    expect(userPrompt).toContain('Why it works')
  })

  it('defaults keyFacts to [] and tolerates an omitted/empty enrichment', async () => {
    const { service } = makeService({})
    const result = await service.build(article)
    expect(result.keyFacts).toEqual([])
    expect(result.pronunciation).toBeUndefined()
  })

  it('slices keyFacts down to at most six', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `L${i}`,
      value: `V${i}`,
    }))
    const { service } = makeService({ keyFacts: many })
    const result = await service.build(article)
    expect(result.keyFacts).toHaveLength(6)
  })
})
