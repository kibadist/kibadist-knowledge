import { FidelityReviewService } from './fidelity-review.service'
import type { FidelityReviewInput } from './fidelity-review.util'
import type { ArticleJsonV2 } from './transformer.types'

const sampleArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'original' },
  abstract: [
    {
      id: 'p1',
      text: 'abstract',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'S',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'sp1',
          type: 'paragraph',
          text: 'body',
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

const baseInput: FidelityReviewInput = {
  article: sampleArticle,
  structureModel: {
    title: null,
    subtitle: null,
    claims: [],
    definitions: [],
    examples: [],
    caveats: [],
    terminology: [],
    originalOutline: [],
    noiseDecisions: [],
    uncertainBlockIds: [],
  },
  blocks: [{ id: 'b1', classification: 'MAIN_ARGUMENT', removable: false }],
  fidelityReport: {
    fidelityScore: 98,
    approved: true,
    addedInformation: [],
    lostInformation: [],
    meaningChanges: [],
    unsupportedHeadings: [],
    missingCaveats: [],
    unsupportedExamples: [],
    emphasisChanges: [],
    structuralFindings: [],
  },
  coverageReport: {
    totalBlocks: 1,
    coveragePercent: 100,
    representedBlockIds: ['b1'],
    removedBlocks: [],
    uncertainBlockIds: [],
    unrepresentedBlockIds: [],
    paragraphMap: [],
  },
  learningLayer: { concepts: [], retrievalPrompts: [] },
}

describe('FidelityReviewService', () => {
  it('delegates to the deterministic rollup and returns a complete report', () => {
    const service = new FidelityReviewService()
    const report = service.review(baseInput)
    expect(report.sourceCoverageScore).toBe(100)
    expect(report.blockerReasons).toEqual([])
    expect(report).toHaveProperty('regenerationHints')
    expect(report).toHaveProperty('reviewerWarnings')
  })
})
