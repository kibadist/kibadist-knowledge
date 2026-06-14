import { messyTranscript } from './__fixtures__/messy-transcript'
import {
  ambiguousBlocks,
  documentationBlocks,
  rawNotesBlocks,
  referenceDocBlocks,
  researchPaperBlocks,
  structuredWebArticleBlocks,
  transcriptLessonBlocks,
} from './__fixtures__/source-kinds'
import { wikipediaExplainer } from './__fixtures__/wikipedia-explainer'
import {
  computeDetectionSignals,
  diagnoseSource,
  pickSourceKind,
  scoreSourceKinds,
  selectArticleShape,
} from './source-diagnosis.util'
import type { ClassifiedBlockInput } from './structure-model.service'

describe('computeDetectionSignals', () => {
  it('derives block-type counts and the ratios over the total', () => {
    const blocks: ClassifiedBlockInput[] = [
      {
        id: '1',
        type: 'HEADING',
        classification: 'CORE',
        text: 'A',
        removable: false,
      },
      {
        id: '2',
        type: 'PARAGRAPH',
        classification: 'CORE',
        text: 'one two three four five six seven eight nine ten eleven twelve',
        removable: false,
      },
      {
        id: '3',
        type: 'LIST',
        classification: 'CORE',
        text: 'a\nb',
        removable: false,
      },
      {
        id: '4',
        type: 'CODE',
        classification: 'CORE',
        text: 'x()',
        removable: false,
      },
    ]
    const s = computeDetectionSignals(blocks)
    expect(s.totalBlocks).toBe(4)
    expect(s.blockTypeCounts).toMatchObject({
      heading: 1,
      paragraph: 1,
      list: 1,
      code: 1,
    })
    expect(s.headingDensity).toBeCloseTo(0.25)
    expect(s.tableListRatio).toBeCloseTo(0.25)
    expect(s.codeRatio).toBeCloseTo(0.25)
  })

  it('handles empty input without dividing by zero', () => {
    const s = computeDetectionSignals([])
    expect(s.totalBlocks).toBe(0)
    expect(s.headingDensity).toBe(0)
    expect(s.tableListRatio).toBe(0)
    expect(s.transcriptScore).toBe(0)
    expect(s.avgParagraphWords).toBe(0)
    expect(s.paragraphLengthCv).toBe(0)
  })

  it('scores transcript markers high and headed prose low', () => {
    const transcript = computeDetectionSignals(transcriptLessonBlocks)
    const article = computeDetectionSignals(structuredWebArticleBlocks)
    expect(transcript.transcriptScore).toBeGreaterThan(article.transcriptScore)
    expect(article.transcriptScore).toBeLessThan(0.2)
  })

  it('measures reference density from inline citation markers', () => {
    const s = computeDetectionSignals(researchPaperBlocks)
    expect(s.referenceDensity).toBeGreaterThan(0)
  })
})

describe('detectSourceKind — the five named kinds map to their shapes', () => {
  const cases: {
    name: string
    blocks: ClassifiedBlockInput[]
    kind: string
    shape: string | null
  }[] = [
    {
      name: 'transcript_lesson → lesson_article',
      blocks: transcriptLessonBlocks,
      kind: 'transcript_lesson',
      shape: 'lesson_article',
    },
    {
      name: 'structured_web_article → concept_explainer',
      blocks: structuredWebArticleBlocks,
      kind: 'structured_web_article',
      shape: 'concept_explainer',
    },
    {
      name: 'research_paper → research_digest',
      blocks: researchPaperBlocks,
      kind: 'research_paper',
      shape: 'research_digest',
    },
    {
      name: 'documentation (code) → technical_walkthrough',
      blocks: documentationBlocks,
      kind: 'documentation',
      shape: 'technical_walkthrough',
    },
    {
      name: 'documentation (reference) → reference_digest',
      blocks: referenceDocBlocks,
      kind: 'documentation',
      shape: 'reference_digest',
    },
    {
      name: 'raw_notes → structured_notes',
      blocks: rawNotesBlocks,
      kind: 'raw_notes',
      shape: 'structured_notes',
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const d = diagnoseSource(c.blocks)
      expect(d.sourceKind).toBe(c.kind)
      expect(d.articleShape).toBe(c.shape)
      expect(d.confidence).toBeGreaterThan(0)
      expect(d.rationale.length).toBeGreaterThan(0)
    })
  }
})

describe('unknown fallback', () => {
  it('falls back to unknown with a null shape when nothing is confident', () => {
    const d = diagnoseSource(ambiguousBlocks)
    expect(d.sourceKind).toBe('unknown')
    expect(d.articleShape).toBeNull()
    expect(d.confidence).toBe(0)
  })

  it('falls back to unknown (not a crash) for empty input', () => {
    const d = diagnoseSource([])
    expect(d.sourceKind).toBe('unknown')
    expect(d.articleShape).toBeNull()
  })

  it('the conservative fallback never depends on external metadata', () => {
    // Same ambiguous blocks, with and without metadata, stay unknown.
    const bare = diagnoseSource(ambiguousBlocks)
    const withMeta = diagnoseSource(ambiguousBlocks, {
      sourceType: 'URL',
      url: 'https://example.com/page',
    })
    expect(bare.sourceKind).toBe('unknown')
    expect(withMeta.sourceKind).toBe('unknown')
  })
})

describe('selectArticleShape — mapping rules', () => {
  const base = computeDetectionSignals(documentationBlocks)
  it('maps every kind deterministically', () => {
    expect(selectArticleShape('transcript_lesson', base)).toBe('lesson_article')
    expect(selectArticleShape('structured_web_article', base)).toBe(
      'concept_explainer',
    )
    expect(selectArticleShape('research_paper', base)).toBe('research_digest')
    expect(selectArticleShape('raw_notes', base)).toBe('structured_notes')
    expect(selectArticleShape('unknown', base)).toBeNull()
  })

  it('documentation splits on the table/list vs code ratio', () => {
    const refSignals = computeDetectionSignals(referenceDocBlocks)
    const codeSignals = computeDetectionSignals(documentationBlocks)
    expect(selectArticleShape('documentation', refSignals)).toBe(
      'reference_digest',
    )
    expect(selectArticleShape('documentation', codeSignals)).toBe(
      'technical_walkthrough',
    )
  })
})

describe('metadata signal boosts', () => {
  it('a wikipedia host reinforces structured_web_article', () => {
    const scores = scoreSourceKinds(
      computeDetectionSignals(structuredWebArticleBlocks, {
        url: 'https://en.wikipedia.org/wiki/Photosynthesis',
      }),
      structuredWebArticleBlocks,
      { url: 'https://en.wikipedia.org/wiki/Photosynthesis' },
    )
    expect(scores.structured_web_article).toBeGreaterThan(scores.documentation)
  })

  it('a docs host reinforces documentation', () => {
    const meta = { url: 'https://docs.acme.io/widget' }
    const withHost = scoreSourceKinds(
      computeDetectionSignals(documentationBlocks, meta),
      documentationBlocks,
      meta,
    )
    const withoutHost = scoreSourceKinds(
      computeDetectionSignals(documentationBlocks),
      documentationBlocks,
    )
    expect(withHost.documentation).toBeGreaterThan(withoutHost.documentation)
  })

  it('a malformed url never throws', () => {
    expect(() =>
      diagnoseSource(structuredWebArticleBlocks, { url: 'not a url' }),
    ).not.toThrow()
  })
})

describe('pickSourceKind', () => {
  it('returns unknown when the best score is below the floor', () => {
    const { kind, confidence } = pickSourceKind({
      transcript_lesson: 0.1,
      structured_web_article: 0.2,
      research_paper: 0.05,
      documentation: 0.0,
      raw_notes: 0.3,
    })
    expect(kind).toBe('unknown')
    expect(confidence).toBe(0)
  })

  it('picks the highest scoring kind above the floor', () => {
    const { kind } = pickSourceKind({
      transcript_lesson: 0.1,
      structured_web_article: 0.8,
      research_paper: 0.05,
      documentation: 0.0,
      raw_notes: 0.3,
    })
    expect(kind).toBe('structured_web_article')
  })
})

describe('golden-fixture cross-checks', () => {
  it('classifies the messy-transcript golden fixture as a transcript', () => {
    const d = diagnoseSource(messyTranscript.blocks)
    expect(d.sourceKind).toBe('transcript_lesson')
    expect(d.articleShape).toBe('lesson_article')
  })

  it('classifies the wikipedia-explainer golden fixture as structured web', () => {
    const d = diagnoseSource(wikipediaExplainer.blocks)
    expect(d.sourceKind).toBe('structured_web_article')
    expect(d.articleShape).toBe('concept_explainer')
  })
})
