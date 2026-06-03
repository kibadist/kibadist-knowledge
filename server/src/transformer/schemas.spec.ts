import {
  ArticleSchema,
  ReshapingPlanSchema,
  SourceStructureModelSchema,
} from './schemas'

describe('zod schemas reject missing/empty sourceBlockIds', () => {
  it('SourceStructureModelSchema rejects a claim with empty sourceBlockIds', () => {
    const result = SourceStructureModelSchema.safeParse({
      claims: [{ text: 'a claim', sourceBlockIds: [] }],
      definitions: [],
      examples: [],
      caveats: [],
      terminology: [],
      originalOutline: [],
      noiseDecisions: [],
      uncertainBlockIds: [],
    })
    expect(result.success).toBe(false)
  })

  it('SourceStructureModelSchema accepts a claim with a non-empty sourceBlockIds', () => {
    const result = SourceStructureModelSchema.safeParse({
      claims: [{ text: 'a claim', sourceBlockIds: ['b1'] }],
      definitions: [],
      examples: [],
      caveats: [],
      terminology: [],
      originalOutline: [],
      noiseDecisions: [],
      uncertainBlockIds: [],
    })
    expect(result.success).toBe(true)
  })

  it('ArticleSchema rejects a paragraph with no sourceBlockIds', () => {
    const result = ArticleSchema.safeParse({
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [
        {
          id: 'p1',
          text: 'x',
          sourceBlockIds: [],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    })
    expect(result.success).toBe(false)
  })

  it('ArticleSchema requires the source_preserving_article mode literal', () => {
    const result = ArticleSchema.safeParse({
      mode: 'something_else',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    })
    expect(result.success).toBe(false)
  })

  it('ReshapingPlanSchema rejects a section with empty sourceBlockIds', () => {
    const result = ReshapingPlanSchema.safeParse({
      titleProposal: { text: 'T', source: 'original' },
      sections: [
        {
          heading: 'H',
          headingSource: 'original',
          sourceBlockIds: [],
          allowedTransformations: [],
        },
      ],
      removedBlocks: [],
      warnings: [],
    })
    expect(result.success).toBe(false)
  })
})
