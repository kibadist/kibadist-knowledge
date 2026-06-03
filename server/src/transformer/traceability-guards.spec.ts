import type { AiService } from '../ai/ai.service'
import { ArticleGeneratorService } from './article-generator.service'
import type { ReshapingPlan } from './schemas'
import {
  type ClassifiedBlockInput,
  StructureModelService,
} from './structure-model.service'

/**
 * Direct unit tests for the code-side traceability guards (DET-251/253): a
 * schema-VALID response that cites a non-existent block id must throw (→ the
 * article pipeline marks the article FAILED). The schema tests cover shape;
 * these cover the "ids must reference REAL blocks" half of the guarantee.
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
  it('throws on a schema-valid model citing an unknown block id', async () => {
    const service = new StructureModelService(
      stubAi({
        claims: [{ text: 'claim', sourceBlockIds: ['ghost'] }],
        definitions: [],
        examples: [],
        caveats: [],
        terminology: [],
        originalOutline: [],
        noiseDecisions: [],
        uncertainBlockIds: [],
      }),
    )
    await expect(service.build(blocks)).rejects.toThrow(/unknown block ids/i)
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
        paragraphs: [
          {
            id: 'p1',
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

  it('throws on a schema-valid article citing an unknown block id', async () => {
    const service = new ArticleGeneratorService(stubAi(articleWith(['ghost'])))
    await expect(service.generate(plan, blocks)).rejects.toThrow(
      /unknown block ids/i,
    )
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
