import type { OutlineSection, SourceSegment } from './learning-outline.types'
import {
  auditOutlineReorder,
  deriveLearningShape,
  deriveSourceKind,
  enforceSourceNotes,
  SHAPE_ROLE_SEQUENCE,
} from './learning-outline.util'
import type { SegmentBlock } from './source-segments.util'

function block(id: string, type: string, classification: string): SegmentBlock {
  return { id, type, classification, text: 't' }
}

function section(
  heading: string,
  sourceBlockIds: string[],
  sourceSegmentIds: string[],
): OutlineSection {
  return {
    heading,
    headingSource: 'inferred',
    headingInferenceReason: 'synthesised',
    sectionRole: 'concept',
    sourceSegmentIds,
    sourceBlockIds,
    conceptFocus: 'focus',
    requiredClaims: [],
    targetReaderOutcome: 'outcome',
  }
}

describe('deriveSourceKind', () => {
  it('returns transcript for a headingless paragraph source', () => {
    expect(
      deriveSourceKind([
        block('b1', 'PARAGRAPH', 'CORE'),
        block('b2', 'PARAGRAPH', 'CORE'),
      ]),
    ).toBe('transcript')
  })

  it('returns encyclopedia for headings + a definition', () => {
    expect(
      deriveSourceKind([
        block('h1', 'HEADING', 'CORE'),
        block('b1', 'PARAGRAPH', 'DEFINITION'),
      ]),
    ).toBe('encyclopedia')
  })

  it('returns research_paper when method + citation matter present', () => {
    expect(
      deriveSourceKind([
        block('b1', 'PARAGRAPH', 'METHOD'),
        block('b2', 'PARAGRAPH', 'CITATION'),
      ]),
    ).toBe('research_paper')
  })

  it('returns tutorial when method present without citations', () => {
    expect(
      deriveSourceKind([
        block('h1', 'HEADING', 'CORE'),
        block('b1', 'LIST', 'METHOD'),
      ]),
    ).toBe('tutorial')
  })

  it('returns unknown for no blocks', () => {
    expect(deriveSourceKind([])).toBe('unknown')
  })
})

describe('deriveLearningShape', () => {
  it('maps transcript → lesson_article', () => {
    expect(deriveLearningShape('transcript')).toBe('lesson_article')
  })
  it('maps research_paper → research_digest', () => {
    expect(deriveLearningShape('research_paper')).toBe('research_digest')
  })
  it('maps encyclopedia → concept_explainer', () => {
    expect(deriveLearningShape('encyclopedia')).toBe('concept_explainer')
  })
  it('falls back to the genre shape for a general article', () => {
    expect(deriveLearningShape('article', 'argument')).toBe('research_digest')
    expect(deriveLearningShape('article', 'explainer')).toBe(
      'concept_explainer',
    )
    expect(deriveLearningShape('article', 'narrative')).toBe('lesson_article')
    expect(deriveLearningShape('article')).toBe('general')
  })
})

describe('SHAPE_ROLE_SEQUENCE', () => {
  it('organises concept_explainer around definition → boundaries → … → misconception', () => {
    expect(SHAPE_ROLE_SEQUENCE.concept_explainer).toEqual([
      'definition',
      'boundaries',
      'types',
      'mechanism',
      'example',
      'application',
      'misconception',
    ])
  })
  it('organises research_digest around question → … → implications', () => {
    expect(SHAPE_ROLE_SEQUENCE.research_digest).toEqual([
      'question',
      'method',
      'evidence',
      'results',
      'limitations',
      'implications',
    ])
  })
})

describe('enforceSourceNotes', () => {
  const segments: SourceSegment[] = [
    {
      id: 'seg1',
      kind: 'content',
      blockIds: ['b1'],
      dominantClassification: 'CORE',
    },
    {
      id: 'seg2',
      kind: 'references',
      blockIds: ['b2'],
      headingText: 'References',
      dominantClassification: 'CITATION',
    },
    {
      id: 'seg3',
      kind: 'externalLinks',
      blockIds: ['b3'],
      headingText: 'External links',
      dominantClassification: 'CITATION',
    },
  ]

  it('demotes a pure source-furniture section into source notes', () => {
    const sections = [
      section('What Is a System', ['b1'], ['seg1']),
      section('References', ['b2'], ['seg2']),
    ]
    const result = enforceSourceNotes(sections, segments)
    expect(result.sections.map((s) => s.heading)).toEqual(['What Is a System'])
    expect(result.sourceNotesPlan.notes.map((n) => n.kind)).toEqual(
      expect.arrayContaining(['references', 'externalLinks']),
    )
    expect(
      result.warnings.some((w) => /Demoted section "References"/.test(w)),
    ).toBe(true)
  })

  it('plans an uncited source-note segment into notes even if no section referenced it', () => {
    const sections = [section('What Is a System', ['b1'], ['seg1'])]
    const result = enforceSourceNotes(sections, segments)
    const kinds = result.sourceNotesPlan.notes.map((n) => n.kind).sort()
    expect(kinds).toEqual(['externalLinks', 'references'])
  })

  it('leaves a source-note segment in place when a content section directly needs it', () => {
    // A content section cites seg2 (references) alongside real content → "directly
    // needed", so it is NOT demoted into notes.
    const sections = [
      section('Methods that cite sources', ['b1', 'b2'], ['seg1', 'seg2']),
    ]
    const result = enforceSourceNotes(sections, segments)
    expect(result.sections).toHaveLength(1)
    expect(result.sourceNotesPlan.notes.map((n) => n.kind)).toEqual([
      'externalLinks',
    ])
  })
})

describe('auditOutlineReorder', () => {
  const blocks = [{ id: 'b1' }, { id: 'b2' }]

  it('warns when a section moves but the move is not recorded', () => {
    // b1 at source 0, b2 at source 1; reading them in reverse moves a section.
    const sections = [
      section('Definition first', ['b2'], ['seg2']),
      section('Argument second', ['b1'], ['seg1']),
    ]
    const warnings = auditOutlineReorder(sections, blocks, [])
    expect(warnings.some((w) => /unaudited reorder/i.test(w))).toBe(true)
  })

  it('does not warn when the move is recorded in reorderings', () => {
    const sections = [
      section('Definition first', ['b2'], ['seg2']),
      section('Argument second', ['b1'], ['seg1']),
    ]
    const warnings = auditOutlineReorder(sections, blocks, [
      {
        sourceBlockId: 'b2',
        fromIndex: 1,
        toIndex: 0,
        reason: 'definition reads better first',
        risk: 'low',
      },
    ])
    expect(warnings).toEqual([])
  })

  it('does not warn when sections keep source order', () => {
    const sections = [
      section('A', ['b1'], ['seg1']),
      section('B', ['b2'], ['seg2']),
    ]
    expect(auditOutlineReorder(sections, blocks, [])).toEqual([])
  })
})
