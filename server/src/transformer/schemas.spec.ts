import {
  ArticleJsonV2Schema,
  ArticleJsonV3Schema,
  ArticleSchema,
  ComparisonTablesLlmSchema,
  GeneratedCalloutsLlmSchema,
  LearningLayerSchema,
  ReshapingPlanSchema,
  SourceStructureModelSchema,
} from './schemas'
import type { ArticleJsonV2, ArticleJsonV3 } from './transformer.types'

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

describe('ArticleJsonV2Schema (DET-277)', () => {
  // A complete v2 article covering every typed block, heading provenance, a
  // nested subsection, reading aids, callout placement and reorder audit.
  const fullV2: ArticleJsonV2 = {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'Title', source: 'original' },
    subtitle: {
      text: 'Sub',
      source: 'cleanedOriginal',
      sourceBlockIds: ['b0'],
    },
    abstract: [
      {
        id: 'a1',
        text: 'abstract',
        sourceBlockIds: ['b1'],
        transformationType: 'verbatim',
        fidelityRisk: 'low',
      },
    ],
    sections: [
      {
        id: 's1',
        heading: 'Original heading',
        headingSource: 'original',
        headingSourceBlockIds: ['b1'],
        sectionRole: 'definition',
        sourceBlockIds: ['b1'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'para',
            sourceBlockIds: ['b1'],
            transformationType: 'light_reword',
            fidelityRisk: 'low',
          },
          {
            id: 'l1',
            type: 'list',
            ordered: true,
            items: ['one', 'two'],
            sourceBlockIds: ['b2'],
            transformationType: 'formatting_only',
            fidelityRisk: 'low',
          },
          {
            id: 'q1',
            type: 'quote',
            text: 'quoted',
            attribution: 'Author',
            sourceBlockIds: ['b3'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'pq1',
            type: 'pullQuote',
            text: 'pulled',
            sourceBlockIds: ['b3'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 't1',
            type: 'table',
            caption: 'cap',
            header: ['A', 'B'],
            rows: [['1', '2']],
            sourceBlockIds: ['b4'],
            transformationType: 'formatting_only',
            fidelityRisk: 'low',
          },
          {
            id: 'c1',
            type: 'code',
            text: 'print(1)',
            language: 'python',
            sourceBlockIds: ['b5'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'f1',
            type: 'figureAnchor',
            suggestionId: 'sug1',
            caption: 'fig',
            sourceBlockIds: ['b6'],
            transformationType: 'formatting_only',
            fidelityRisk: 'low',
          },
          {
            id: 'co1',
            type: 'callout',
            calloutType: 'note',
            title: 'Note',
            text: 'aside',
            sourceBlockIds: ['b7'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
        subsections: [
          {
            id: 's1a',
            heading: 'Nested',
            headingSource: 'inferred',
            sourceBlockIds: ['b8'],
            blocks: [
              {
                id: 'p2',
                type: 'paragraph',
                text: 'nested para',
                sourceBlockIds: ['b8'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      },
    ],
    keyTerms: [{ term: 'K', sourceBlockIds: ['b1'] }],
    sourceExamples: [{ text: 'EX', sourceBlockIds: ['b2'] }],
    caveats: [{ text: 'CV', sourceBlockIds: ['b3'] }],
    originalStructure: [
      { blockId: 'b1', blockType: 'PARAGRAPH', preview: 'p' },
    ],
    readingAids: {
      toc: [
        {
          sectionId: 's1',
          heading: 'Original heading',
          headingSource: 'original',
          children: [
            { sectionId: 's1a', heading: 'Nested', headingSource: 'original' },
          ],
        },
      ],
      readingTime: { wordCount: 120, minutes: 3 },
      highlights: [{ text: 'highlight', sourceBlockIds: ['b1'] }],
    },
    calloutPlacements: {
      bySection: {
        s1: [
          {
            id: 'co-caveat-0',
            kind: 'caveat',
            text: 'CV',
            sourceBlockIds: ['b3'],
            placementReason:
              "1/1 source block overlap section 'Original heading'",
          },
        ],
      },
      unplaced: [
        {
          id: 'co-keyTerm-0',
          kind: 'keyTerm',
          term: 'K',
          text: 'K',
          sourceBlockIds: ['bX'],
          placementReason: 'No source-block overlap with any section.',
        },
      ],
    },
    shape: 'explainer',
    reorderings: [
      {
        sourceBlockId: 'b2',
        fromIndex: 0,
        toIndex: 2,
        movedWithClusterIds: ['b3'],
        reason: 'readability',
        risk: 'low',
      },
    ],
  }

  it('validates a complete v2 article (all block types, nesting, aids, placements, reorderings)', () => {
    const result = ArticleJsonV2Schema.safeParse(fullV2)
    expect(result.success).toBe(true)
  })

  it('validates a minimal v2 article (no optional top-level fields)', () => {
    const minimal: ArticleJsonV2 = {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    }
    expect(ArticleJsonV2Schema.safeParse(minimal).success).toBe(true)
  })

  it('rejects a wrong schemaVersion', () => {
    const result = ArticleJsonV2Schema.safeParse({
      ...fullV2,
      schemaVersion: 'v1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a block with empty sourceBlockIds', () => {
    const broken = structuredClone(fullV2)
    broken.sections[0].blocks[0].sourceBlockIds = []
    expect(ArticleJsonV2Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects a source highlight with empty sourceBlockIds', () => {
    const broken = structuredClone(fullV2)
    broken.readingAids = {
      toc: [
        {
          sectionId: 's1',
          heading: 'Original heading',
          headingSource: 'original',
        },
      ],
      readingTime: { wordCount: 10, minutes: 1 },
      highlights: [{ text: 'x', sourceBlockIds: [] }],
    }
    expect(ArticleJsonV2Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects an unknown block type', () => {
    const broken = structuredClone(fullV2) as unknown as {
      sections: { blocks: { type: string }[] }[]
    }
    broken.sections[0].blocks[0].type = 'sidebar'
    expect(ArticleJsonV2Schema.safeParse(broken).success).toBe(false)
  })
})

describe('LearningLayerSchema conceptCandidates (DET-283)', () => {
  it('still parses an old stored layer without conceptCandidates (additive)', () => {
    const old = {
      concepts: [
        {
          id: 'c1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          validationStatus: 'pending',
        },
      ],
      retrievalPrompts: [],
    }
    expect(LearningLayerSchema.safeParse(old).success).toBe(true)
  })

  it('parses a layer carrying conceptCandidates', () => {
    const withCandidates = {
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          blockType: 'paragraph',
          sectionRole: 'definition',
          aiAssisted: true,
          validationStatus: 'pending',
        },
      ],
    }
    expect(LearningLayerSchema.safeParse(withCandidates).success).toBe(true)
  })

  it('rejects a candidate with empty sourceBlockIds', () => {
    const broken = {
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: [],
          aiAssisted: true,
          validationStatus: 'pending',
        },
      ],
    }
    expect(LearningLayerSchema.safeParse(broken).success).toBe(false)
  })

  it('rejects a candidate with aiAssisted !== true', () => {
    const broken = {
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          aiAssisted: false,
          validationStatus: 'pending',
        },
      ],
    }
    expect(LearningLayerSchema.safeParse(broken).success).toBe(false)
  })
})

describe('v3 source-grounded extras schemas (DET-350)', () => {
  it('ArticleJsonV3Schema validates a full v3 article (generated callouts, tables, source notes)', () => {
    const v3: ArticleJsonV3 = {
      schemaVersion: 'v3',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
      calloutPlacements: {
        bySection: {},
        unplaced: [],
        generated: [
          {
            id: 'gco-definition-0',
            type: 'definition',
            title: 'Term',
            body: 'A definition from the source.',
            sourceBlockIds: ['b1'],
            relatedSectionIds: ['s1'],
            fidelityRisk: 'low',
          },
        ],
      },
      tables: [
        {
          id: 'gtbl-0',
          title: 'A vs B',
          columns: ['X', 'Y'],
          rows: [
            { cells: [{ text: 'a' }, { text: 'b' }], sourceBlockIds: ['b1'] },
            { cells: [{ text: 'c' }, { text: 'd' }], sourceBlockIds: ['b2'] },
          ],
          sourceBlockIds: ['b1', 'b2'],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
      ],
      sourceNotes: {
        references: [{ text: '[1] Source.', sourceBlockIds: ['b3'] }],
        bibliography: [],
        externalLinks: [
          { text: 'link', sourceBlockIds: ['b4'], url: 'https://x.test' },
        ],
        removedNavigation: [],
        lowImportance: [],
      },
    }
    expect(ArticleJsonV3Schema.safeParse(v3).success).toBe(true)
  })

  it('rejects a generated callout with empty sourceBlockIds', () => {
    const result = ArticleJsonV3Schema.safeParse({
      schemaVersion: 'v3',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
      tables: [],
      sourceNotes: {
        references: [],
        bibliography: [],
        externalLinks: [],
        removedNavigation: [],
        lowImportance: [],
      },
      calloutPlacements: {
        bySection: {},
        unplaced: [],
        generated: [
          {
            id: 'gco-key_idea-0',
            type: 'key_idea',
            title: 'T',
            body: 'B',
            sourceBlockIds: [], // empty grounding → rejected
            relatedSectionIds: [],
            fidelityRisk: 'low',
          },
        ],
      },
    })
    expect(result.success).toBe(false)
  })

  it('GeneratedCalloutsLlmSchema loosens grounding and defaults fidelityRisk', () => {
    const parsed = GeneratedCalloutsLlmSchema.parse({
      callouts: [{ type: 'remember', title: 'T', body: 'B' }],
    })
    expect(parsed.callouts[0].sourceBlockIds).toEqual([])
    expect(parsed.callouts[0].relatedSectionIds).toEqual([])
    expect(parsed.callouts[0].fidelityRisk).toBe('medium')
  })

  it('ComparisonTablesLlmSchema requires at least two columns', () => {
    const ok = ComparisonTablesLlmSchema.safeParse({
      tables: [
        {
          title: 'T',
          columns: ['A', 'B'],
          rows: [{ cells: [{ text: 'a' }], sourceBlockIds: ['b1'] }],
        },
      ],
    })
    expect(ok.success).toBe(true)
    const bad = ComparisonTablesLlmSchema.safeParse({
      tables: [{ title: 'T', columns: ['A'], rows: [] }],
    })
    expect(bad.success).toBe(false)
  })
})
