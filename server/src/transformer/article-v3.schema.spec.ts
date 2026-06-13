import {
  ArticleJsonV3Schema,
  isArticleV3,
  parseArticleV3,
} from './article-v3.schema'
import type { ArticleJsonV3, SourceTrace } from './article-v3.types'

/** A grounded trace helper — the common case for source-derived content. */
const grounded = (ids: string[]): SourceTrace => ({
  grounded: true,
  sourceBlockIds: ids,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

/** An ungrounded trace — model scaffolding (e.g. a synthesised prompt). */
const ungrounded: SourceTrace = {
  grounded: false,
  sourceBlockIds: [],
  transformationType: 'light_reword',
  fidelityRisk: 'low',
  note: 'synthesised active-recall prompt',
}

/**
 * A complete v3 article exercising every top-level field, every block type, a
 * nested subsection, grounded + ungrounded traces, callout placement, an elevated
 * table, source notes, references and the quality report.
 */
const fullV3: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'article',
  shape: 'explainer',
  title: {
    text: 'Spaced Repetition',
    source: 'original',
    sourceTrace: grounded(['b0']),
  },
  dek: 'Why reviewing at increasing intervals beats cramming.',
  abstract: [
    { id: 'a1', text: 'A summary paragraph.', sourceTrace: grounded(['b1']) },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Understand the forgetting curve',
      objective: 'Explain why memory decays over time.',
      sectionId: 's1',
      conceptIds: ['kc1'],
      sourceTrace: grounded(['b1']),
    },
    {
      id: 'lp2',
      order: 1,
      title: 'Apply spacing',
      objective: 'Schedule reviews at increasing intervals.',
      conceptIds: ['kc1'],
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'The forgetting curve',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      summary: 'Memory decays predictably without review.',
      sectionRole: 'definition',
      sourceTrace: grounded(['b1']),
      conceptIds: ['kc1'],
      claimIds: ['cl1'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Memory fades along a curve.',
          sourceTrace: grounded(['b1']),
        },
        {
          id: 'l1',
          type: 'list',
          ordered: true,
          items: ['Review day 1', 'Review day 3'],
          sourceTrace: grounded(['b2']),
        },
        {
          id: 'q1',
          type: 'quote',
          text: 'Spacing effect.',
          attribution: 'Ebbinghaus',
          sourceTrace: grounded(['b3']),
        },
        {
          id: 'c1',
          type: 'code',
          text: 'review(card)',
          language: 'python',
          sourceTrace: grounded(['b4']),
        },
        {
          id: 'f1',
          type: 'figure',
          suggestionId: 'sug1',
          caption: 'The curve',
          sourceTrace: grounded(['b1']),
        },
      ],
      subsections: [
        {
          id: 's1a',
          heading: 'Nested detail',
          headingSource: 'inferred',
          sourceTrace: grounded(['b5']),
          blocks: [
            {
              id: 'p2',
              type: 'paragraph',
              text: 'A nested paragraph.',
              sourceTrace: grounded(['b5']),
            },
          ],
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc1',
      label: 'Spacing effect',
      definition: 'Spread-out review strengthens memory.',
      aliases: ['distributed practice'],
      sectionId: 's1',
      importance: 0.9,
      sourceTrace: grounded(['b1']),
    },
  ],
  keyClaims: [
    {
      id: 'cl1',
      statement: 'Spacing improves long-term retention.',
      claimType: 'causal',
      sectionId: 's1',
      sourceTrace: grounded(['b1']),
    },
  ],
  terminology: [
    {
      id: 'tm1',
      term: 'Forgetting curve',
      definition: 'The decay of recall over time.',
      sourceTrace: grounded(['b1']),
    },
  ],
  sourceExamples: [
    {
      id: 'ex1',
      text: 'Reviewing vocabulary cards.',
      label: 'Example',
      sectionId: 's1',
      sourceTrace: grounded(['b2']),
    },
  ],
  misconceptionWarnings: [
    {
      id: 'mc1',
      misconception: 'Cramming works long term.',
      correction: 'Cramming fades fast; spacing endures.',
      sectionId: 's1',
      sourceTrace: grounded(['b1']),
    },
  ],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'Why does spacing beat cramming?',
      answer: 'It interrupts forgetting at the right moment.',
      conceptIds: ['kc1'],
      sourceTrace: ungrounded,
    },
  ],
  calloutPlacements: {
    bySection: {
      s1: [
        {
          id: 'co-keyTerm-0',
          kind: 'keyTerm',
          term: 'Spacing effect',
          text: 'Spread-out review strengthens memory.',
          placementReason: '1/1 source block overlaps section.',
          sourceTrace: grounded(['b1']),
        },
      ],
    },
    unplaced: [
      {
        id: 'co-caveat-0',
        kind: 'caveat',
        text: 'Not all material benefits equally.',
        placementReason: 'No confident section match.',
        sourceTrace: grounded(['b6']),
      },
    ],
  },
  tables: [
    {
      id: 'tbl1',
      caption: 'Review schedule',
      header: ['Day', 'Action'],
      rows: [['1', 'Review']],
      sectionId: 's1',
      sourceTrace: grounded(['b2']),
    },
  ],
  sourceNotes: [
    {
      id: 'sn1',
      kind: 'gap',
      text: 'The source never defines "interval".',
      sourceTrace: grounded(['b1']),
    },
    { id: 'sn2', kind: 'editorial', text: 'Two sections were merged.' },
  ],
  references: [
    {
      id: 'ref1',
      citationText: 'Ebbinghaus (1885)',
      title: 'Memory',
      url: 'https://example.com',
      sourceTrace: grounded(['b3']),
    },
  ],
  provenance: {
    sourceKind: 'article',
    generationMode: 'source_grounded_learning_article',
    sourceId: 'src1',
    blocksVersion: 2,
    model: 'gpt-4o-mini',
    pipelineVersion: 1,
    generatedAt: '2026-06-12T00:00:00.000Z',
  },
  qualityReport: {
    groundingScore: 0.95,
    coverageScore: 0.88,
    conceptCoverageScore: 0.8,
    approved: true,
    issues: [
      {
        severity: 'low',
        category: 'added_information',
        description: 'One synthesised prompt is ungrounded.',
        articleRef: 'rp1',
      },
    ],
  },
}

describe('ArticleJsonV3Schema (DET-344)', () => {
  it('validates a complete v3 article (all fields, block types, nesting, traces)', () => {
    expect(ArticleJsonV3Schema.safeParse(fullV3).success).toBe(true)
  })

  it('validates a minimal v3 article (all collections empty)', () => {
    const minimal: ArticleJsonV3 = {
      schemaVersion: 'v3',
      mode: 'source_grounded_learning_article',
      sourceKind: 'plain_text',
      shape: 'hybrid',
      title: { text: 'T', source: 'inferred' },
      abstract: [],
      learningPath: [],
      sections: [],
      keyConcepts: [],
      keyClaims: [],
      terminology: [],
      sourceExamples: [],
      misconceptionWarnings: [],
      retrievalPrompts: [],
      calloutPlacements: { bySection: {}, unplaced: [] },
      tables: [],
      sourceNotes: [],
      references: [],
      provenance: {
        sourceKind: 'plain_text',
        generationMode: 'source_grounded_learning_article',
        pipelineVersion: 1,
      },
      qualityReport: {
        groundingScore: 1,
        coverageScore: 1,
        conceptCoverageScore: 1,
        approved: true,
        issues: [],
      },
    }
    expect(ArticleJsonV3Schema.safeParse(minimal).success).toBe(true)
  })

  it('rejects a wrong schemaVersion', () => {
    expect(
      ArticleJsonV3Schema.safeParse({ ...fullV3, schemaVersion: 'v2' }).success,
    ).toBe(false)
  })

  it('rejects a wrong mode literal', () => {
    expect(
      ArticleJsonV3Schema.safeParse({
        ...fullV3,
        mode: 'source_preserving_article',
      }).success,
    ).toBe(false)
  })

  it('rejects a grounded trace with no source blocks (traceability gate)', () => {
    const broken = structuredClone(fullV3)
    broken.sections[0].blocks[0].sourceTrace = {
      grounded: true,
      sourceBlockIds: [],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    }
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('accepts an ungrounded trace with no source blocks (model scaffolding)', () => {
    const ok = structuredClone(fullV3)
    ok.retrievalPrompts[0].sourceTrace = {
      grounded: false,
      sourceBlockIds: [],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    }
    expect(ArticleJsonV3Schema.safeParse(ok).success).toBe(true)
  })

  it('rejects an unknown block type', () => {
    const broken = structuredClone(fullV3) as unknown as {
      sections: { blocks: { type: string }[] }[]
    }
    broken.sections[0].blocks[0].type = 'sidebar'
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects a concept candidate with importance out of range', () => {
    const broken = structuredClone(fullV3)
    broken.keyConcepts[0].importance = 1.5
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects a quality score outside 0..1', () => {
    const broken = structuredClone(fullV3)
    broken.qualityReport.groundingScore = 2
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects an unknown quality-issue category', () => {
    const broken = structuredClone(fullV3) as unknown as {
      qualityReport: { issues: { category: string }[] }
    }
    broken.qualityReport.issues[0].category = 'made_up'
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects an empty paragraph id', () => {
    const broken = structuredClone(fullV3)
    broken.abstract[0].id = ''
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })

  it('rejects provenance with pipelineVersion < 1', () => {
    const broken = structuredClone(fullV3)
    broken.provenance.pipelineVersion = 0
    expect(ArticleJsonV3Schema.safeParse(broken).success).toBe(false)
  })
})

describe('isArticleV3 / parseArticleV3', () => {
  it('isArticleV3 is true only for a v3-stamped object', () => {
    expect(isArticleV3(fullV3)).toBe(true)
    expect(isArticleV3({ schemaVersion: 'v2' })).toBe(false)
    expect(isArticleV3(null)).toBe(false)
    expect(isArticleV3('v3')).toBe(false)
  })

  it('parseArticleV3 returns the typed value for a valid payload', () => {
    const parsed = parseArticleV3(fullV3)
    expect(parsed.title.text).toBe('Spaced Repetition')
  })

  it('parseArticleV3 throws a descriptive error for an invalid payload', () => {
    expect(() => parseArticleV3({ schemaVersion: 'v3' })).toThrow(
      /Article JSON v3 failed validation/,
    )
  })
})
