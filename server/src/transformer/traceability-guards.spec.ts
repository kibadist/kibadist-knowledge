import type { AiService } from '../ai/ai.service'
import { ArticleGeneratorService } from './article-generator.service'
import type { ReshapingPlan } from './schemas'
import {
  type ClassifiedBlockInput,
  StructureModelService,
} from './structure-model.service'

/**
 * Direct unit tests for the code-side traceability guards (DET-251/253). The
 * generator's guard still fails loudly on an untraceable id; the two pre-generator
 * stages (structure model, reshaping plan) instead REPAIR benign drift — an
 * invented id is pruned and an entry left unsourced is dropped, so a single
 * hallucinated cuid no longer sinks an otherwise-faithful model. The schema tests
 * cover shape; these cover the "ids must reference REAL blocks" half.
 */

function stubAi(response: unknown): AiService {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  return { complete } as unknown as AiService
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'the argument',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'the definition',
    removable: false,
  },
]

describe('StructureModelService traceability guard', () => {
  it('drops a hallucinated id instead of failing, keeping the real citation', async () => {
    const service = new StructureModelService(
      stubAi({
        // First claim's only ref is invented → the claim is dropped; the second
        // mixes a real and an invented id → the invented one is pruned.
        claims: [
          { text: 'invented', sourceBlockIds: ['ghost'] },
          { text: 'real', sourceBlockIds: ['b1', 'ghost'] },
        ],
        definitions: [],
        examples: [],
        caveats: [],
        terminology: [],
        originalOutline: [],
        noiseDecisions: [],
        uncertainBlockIds: [],
      }),
    )
    const model = await service.build(blocks)
    expect(model.claims).toHaveLength(1)
    expect(model.claims[0].text).toBe('real')
    expect(model.claims[0].sourceBlockIds).toEqual(['b1'])
  })

  it('accepts a model whose every citation resolves', async () => {
    const service = new StructureModelService(
      stubAi({
        claims: [{ text: 'claim', sourceBlockIds: ['b1'] }],
        definitions: [
          {
            term: 'the term',
            definition: 'the definition',
            sourceBlockIds: ['b2'],
          },
        ],
        examples: [],
        caveats: [],
        terminology: [],
        originalOutline: [],
        noiseDecisions: [],
        uncertainBlockIds: [],
      }),
    )
    const model = await service.build(blocks)
    expect(model.claims[0].sourceBlockIds).toEqual(['b1'])
  })
})

describe('ArticleGeneratorService traceability guard', () => {
  const plan: ReshapingPlan = {
    titleProposal: { text: 'T', source: 'original' },
    shape: 'hybrid',
    sections: [
      {
        heading: 'H',
        headingSource: 'original',
        sourceBlockIds: ['b1'],
        allowedTransformations: ['grammar_cleanup'],
      },
    ],
    removedBlocks: [],
    warnings: [],
    reorderings: [],
  }

  const articleWith = (sourceBlockIds: string[]) => ({
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [
      {
        id: 'p0',
        text: 'abstract',
        sourceBlockIds: ['b1'],
        transformationType: 'verbatim',
        fidelityRisk: 'low',
      },
    ],
    sections: [
      {
        id: 's1',
        heading: 'H',
        headingSource: 'original',
        sourceBlockIds: ['b1'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'body',
            sourceBlockIds,
            transformationType: 'grammar_cleanup',
            fidelityRisk: 'low',
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
  })

  it('drops a block citing only an unknown id instead of failing (DET-319)', async () => {
    const service = new ArticleGeneratorService(stubAi(articleWith(['ghost'])))
    // Traceability repair prunes the untraceable block before assertKnownIds; the
    // section survives (its own citation is real) with no blocks left.
    const article = await service.generate(plan, blocks)
    expect(article.sections[0].blocks).toEqual([])
  })

  it('re-derives originalStructure from real blocks, ignoring the model copy', async () => {
    const service = new ArticleGeneratorService(stubAi(articleWith(['b1'])))
    const article = await service.generate(plan, blocks)
    expect(article.originalStructure.map((o) => o.blockId)).toEqual([
      'b1',
      'b2',
    ])
  })
})
