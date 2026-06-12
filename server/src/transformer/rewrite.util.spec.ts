import type { RewriteSectionLlm } from './rewrite.schemas'
import type { SourceSegment } from './rewrite.types'
import {
  finalizeSection,
  indexSegments,
  type RewriteContext,
} from './rewrite.util'

/**
 * Unit spec for the pure rewrite post-processing (DET-349). These tests pin the
 * acceptance-critical guards without the network: unsupported paragraphs are
 * dropped, AI-invented callouts/analogies are dropped, risk is floored, confidence
 * clamped, anchor ids minted, and a section's provenance is the union of its
 * content.
 */

const segments: SourceSegment[] = [
  {
    id: 'seg1',
    summary: 'intro',
    blocks: [
      { id: 'b1', role: 'core_claim', text: 'A core claim.' },
      { id: 'b2', role: 'analogy', text: 'It is like a funnel.' },
      { id: 'b3', role: 'example', text: 'For example, 429 responses.' },
    ],
  },
]

function ctx(): RewriteContext {
  const { known, roleByBlockId } = indexSegments(segments)
  return { sectionId: 's0', known, roleByBlockId }
}

/** A minimal valid rewritten section; tests override the slice they exercise. */
function section(overrides: Partial<RewriteSectionLlm>): RewriteSectionLlm {
  return {
    heading: 'A heading',
    headingSource: 'inferred',
    paragraphs: [],
    ...overrides,
  }
}

describe('indexSegments', () => {
  it('collects the block id universe and per-block roles', () => {
    const { known, roleByBlockId } = indexSegments(segments)
    expect([...known].sort()).toEqual(['b1', 'b2', 'b3'])
    expect(roleByBlockId.get('b2')).toBe('analogy')
  })
})

describe('finalizeSection — paragraph traceability', () => {
  it('mints ids, keeps known ids, and clamps confidence to [0,1]', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'First.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 5,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.paragraphs).toHaveLength(1)
    expect(out?.paragraphs[0].id).toBe('s0-p0')
    expect(out?.paragraphs[0].trace.confidence).toBe(1)
    expect(out?.sourceBlockIds).toEqual(['b1'])
  })

  it('prunes hallucinated block ids and drops a paragraph left unsupported', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Grounded.',
            sourceBlockIds: ['b1', 'ghost'],
            transformationType: 'source_grounded_rewrite',
            fidelityRisk: 'low',
            confidence: 0.9,
          },
          {
            text: 'Unsupported — every cited id is invented.',
            sourceBlockIds: ['ghost1', 'ghost2'],
            transformationType: 'source_grounded_inference',
            fidelityRisk: 'low',
            confidence: 0.5,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.paragraphs).toHaveLength(1)
    expect(out?.paragraphs[0].trace.sourceBlockIds).toEqual(['b1'])
  })

  it('floors fidelity risk for inference and scaffold transforms', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'An inferred connection.',
            sourceBlockIds: ['b1'],
            transformationType: 'source_grounded_inference',
            fidelityRisk: 'low',
            confidence: 0.5,
          },
          {
            text: 'Connective framing.',
            sourceBlockIds: ['b1'],
            transformationType: 'ai_assisted_scaffold',
            fidelityRisk: 'low',
            confidence: 0.5,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.paragraphs[0].trace.fidelityRisk).toBe('medium')
    expect(out?.paragraphs[1].trace.fidelityRisk).toBe('high')
  })
})

describe('finalizeSection — callouts', () => {
  it('drops a callout the model flagged grounded:false (AI-invented)', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Body.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 1,
          },
        ],
        callouts: [
          {
            calloutType: 'key_idea',
            text: 'An invented idea.',
            sourceBlockIds: ['b1'],
            grounded: false,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.callouts).toBeUndefined()
  })

  it('keeps a source_analogy only when grounded in an analogy-role block', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Body.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 1,
          },
        ],
        callouts: [
          {
            calloutType: 'source_analogy',
            text: 'It is like a funnel.',
            sourceBlockIds: ['b2'],
            grounded: true,
          },
          {
            // Analogy citing a non-analogy block → AI-invented → dropped.
            calloutType: 'source_analogy',
            text: 'It is like a river.',
            sourceBlockIds: ['b1'],
            grounded: true,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.callouts).toHaveLength(1)
    expect(out?.callouts?.[0].id).toBe('s0-c0')
    expect(out?.callouts?.[0].sourceBlockIds).toEqual(['b2'])
  })

  it('drops a callout that cites no surviving source block', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Body.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 1,
          },
        ],
        callouts: [
          {
            calloutType: 'definition',
            text: 'Orphan.',
            sourceBlockIds: ['ghost'],
            grounded: true,
          },
        ],
      }),
      ctx(),
    )
    expect(out?.callouts).toBeUndefined()
  })
})

describe('finalizeSection — tables and section dropping', () => {
  it('keeps a source-grounded table and drops empty rows', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Body.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 1,
          },
        ],
        tables: [
          {
            caption: 'Codes',
            header: ['Code', 'Meaning'],
            rows: [['429', 'Too many requests'], []],
            sourceBlockIds: ['b3'],
          },
        ],
      }),
      ctx(),
    )
    expect(out?.tables).toHaveLength(1)
    expect(out?.tables?.[0].rows).toEqual([['429', 'Too many requests']])
    expect(out?.tables?.[0].id).toBe('s0-t0')
  })

  it('drops a section whose every paragraph is unsupported', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'All invented.',
            sourceBlockIds: ['ghost'],
            transformationType: 'source_grounded_rewrite',
            fidelityRisk: 'low',
            confidence: 0.5,
          },
        ],
      }),
      ctx(),
    )
    expect(out).toBeNull()
  })

  it('finalizes one level of subsections and unions their provenance', () => {
    const out = finalizeSection(
      section({
        paragraphs: [
          {
            text: 'Parent body.',
            sourceBlockIds: ['b1'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
            confidence: 1,
          },
        ],
        subsections: [
          section({
            heading: 'Child',
            paragraphs: [
              {
                text: 'Child body.',
                sourceBlockIds: ['b3'],
                transformationType: 'source_grounded_summary',
                fidelityRisk: 'low',
                confidence: 0.8,
              },
            ],
          }),
        ],
      }),
      ctx(),
    )
    expect(out?.subsections).toHaveLength(1)
    expect(out?.subsections?.[0].id).toBe('s0-s0')
    expect(out?.sourceBlockIds).toEqual(['b1', 'b3'])
  })
})
