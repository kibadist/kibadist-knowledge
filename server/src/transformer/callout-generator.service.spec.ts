import type { AiService } from '../ai/ai.service'
import { CalloutGeneratorService } from './callout-generator.service'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new CalloutGeneratorService(ai)
}

/**
 * The transformer transcript: a spoken explanation that draws an audio-mixer /
 * Beatles analogy for how a transformer's attention blends signals. The analogy
 * is the SOURCE's own — so it should become a `source_analogy` callout citing the
 * block(s) it came from.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'A transformer layer mixes information across all the tokens at once.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'EXAMPLE',
    text: 'Think of it like an audio mixer: attention is the engineer sliding faders so each token hears the right blend of the others — like remastering a Beatles track from its separate stems.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'How a transformer mixes tokens', source: 'inferred' },
  abstract: [],
  sections: [
    {
      id: 's1',
      heading: 'Attention as mixing',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A transformer layer mixes information across all the tokens at once.',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

describe('CalloutGeneratorService', () => {
  it('keeps the source-drawn audio-mixer/Beatles analogy as a grounded source_analogy callout', async () => {
    const service = makeService({
      callouts: [
        {
          type: 'source_analogy',
          title: 'Attention is an audio mixer',
          body: 'The source likens attention to an audio engineer sliding faders so each token hears the right blend of the others, like remastering a Beatles track from its stems.',
          sourceBlockIds: ['b2'],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
      ],
    })

    const callouts = await service.generate(article, blocks)
    expect(callouts).toHaveLength(1)
    expect(callouts[0]).toMatchObject({
      id: 'gco-source_analogy-0',
      type: 'source_analogy',
      sourceBlockIds: ['b2'],
      relatedSectionIds: ['s1'],
      fidelityRisk: 'low',
    })
  })

  it('rejects an ungrounded callout and clamps related sections to real ids', async () => {
    const service = makeService({
      callouts: [
        {
          // No valid source grounding → dropped (unsupported).
          type: 'key_idea',
          title: 'Invented claim',
          body: 'Something the source never says.',
          sourceBlockIds: ['ghost'],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'medium',
        },
        {
          type: 'definition',
          title: 'Token mixing',
          body: 'A transformer layer mixes information across all tokens at once.',
          sourceBlockIds: ['b1', 'ghost'], // ghost pruned, b1 kept
          relatedSectionIds: ['s1', 'sX'], // sX clamped away
          fidelityRisk: 'low',
        },
      ],
    })

    const callouts = await service.generate(article, blocks)
    expect(callouts).toHaveLength(1)
    expect(callouts[0].type).toBe('definition')
    expect(callouts[0].sourceBlockIds).toEqual(['b1'])
    expect(callouts[0].relatedSectionIds).toEqual(['s1'])
  })

  it('defaults a missing fidelityRisk to medium', async () => {
    const service = makeService({
      callouts: [
        {
          type: 'remember',
          title: 'Key point',
          body: 'A transformer layer mixes information across all tokens at once.',
          sourceBlockIds: ['b1'],
          relatedSectionIds: [],
        },
      ],
    })
    const callouts = await service.generate(article, blocks)
    expect(callouts[0].fidelityRisk).toBe('medium')
  })
})
