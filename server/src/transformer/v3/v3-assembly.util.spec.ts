import {
  assembleArticleV3,
  selectShape,
  summarizeProvenance,
} from './v3-assembly.util'
import type { V3LearningLlm, V3RewriteLlm } from './v3-schemas'

const KNOWN = new Set(['b1', 'b2', 'b3'])

function rewrite(partial: Partial<V3RewriteLlm> = {}): V3RewriteLlm {
  return {
    title: 'Title',
    summary: 'Summary',
    sections: [],
    ...partial,
  }
}

function learning(partial: Partial<V3LearningLlm> = {}): V3LearningLlm {
  return {
    learningPath: [],
    keyConcepts: [],
    keyClaims: [],
    retrievalPrompts: [],
    sourceNotes: [],
    ...partial,
  }
}

describe('assembleArticleV3 (DET-343)', () => {
  it('mints deterministic ids and grounds blocks that cite real source ids', () => {
    const article = assembleArticleV3(
      rewrite({
        sections: [
          {
            heading: 'Heap',
            sourceBlockIds: ['b1'],
            blocks: [
              {
                type: 'paragraph',
                text: 'The heap stores objects.',
                sourceBlockIds: ['b1', 'bogus'],
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      }),
      learning(),
      'structured_article',
      KNOWN,
    )

    const section = article.sections[0]
    expect(section.id).toBe('sec-0')
    expect(section.blocks[0].id).toBe('sec-0-b-0')
    // The bogus id is dropped; the real one survives and grounds the block.
    expect(section.blocks[0].sourceBlockIds).toEqual(['b1'])
    expect(section.blocks[0].provenance).toBe('source')
  })

  it('marks a block that cites no real id as scaffold', () => {
    const article = assembleArticleV3(
      rewrite({
        sections: [
          {
            heading: 'Transition',
            sourceBlockIds: [],
            blocks: [
              {
                type: 'paragraph',
                text: 'Now that we understand X, consider Y.',
                sourceBlockIds: ['ghost'],
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      }),
      learning(),
      'mixed',
      KNOWN,
    )
    expect(article.sections[0].blocks[0].provenance).toBe('scaffold')
    expect(article.sections[0].blocks[0].sourceBlockIds).toEqual([])
  })

  it('drops ungrounded concepts/prompts/notes but keeps unsupported claims flagged', () => {
    const article = assembleArticleV3(
      rewrite(),
      learning({
        keyConcepts: [
          { label: 'Grounded', definition: 'd', sourceBlockIds: ['b1'] },
          { label: 'Ungrounded', definition: 'd', sourceBlockIds: ['ghost'] },
        ],
        keyClaims: [
          { text: 'Backed claim', sourceBlockIds: ['b2'] },
          { text: 'Floating claim', sourceBlockIds: [] },
        ],
        retrievalPrompts: [
          { prompt: 'Real?', sourceBlockIds: ['b1'] },
          { prompt: 'Fake?', sourceBlockIds: ['ghost'] },
        ],
        sourceNotes: [{ text: 'note', sourceBlockIds: ['ghost'] }],
      }),
      'structured_article',
      KNOWN,
    )

    expect(article.learning.keyConcepts.map((c) => c.label)).toEqual([
      'Grounded',
    ])
    expect(article.learning.retrievalPrompts).toHaveLength(1)
    expect(article.learning.sourceNotes).toHaveLength(0)
    // Both claims kept; support reflects grounding.
    expect(article.learning.keyClaims.map((c) => c.support)).toEqual([
      'grounded',
      'unsupported',
    ])
  })

  it('resolves learning-path section refs by heading and 1-based index', () => {
    const article = assembleArticleV3(
      rewrite({
        sections: [
          { heading: 'Alpha', sourceBlockIds: ['b1'], blocks: [] },
          { heading: 'Beta', sourceBlockIds: ['b2'], blocks: [] },
        ],
      }),
      learning({
        learningPath: [
          { objective: 'Do alpha', sectionRefs: ['Alpha'] },
          { objective: 'Do beta', sectionRefs: ['2'] },
        ],
      }),
      'mixed',
      KNOWN,
    )
    expect(article.learning.learningPath[0].sectionIds).toEqual(['sec-0'])
    expect(article.learning.learningPath[1].sectionIds).toEqual(['sec-1'])
  })

  it('computes the provenance summary from the final blocks', () => {
    const summary = summarizeProvenance([
      {
        id: 'sec-0',
        heading: 'h',
        headingProvenance: 'source',
        sourceBlockIds: ['b1'],
        blocks: [
          {
            id: 'a',
            type: 'paragraph',
            text: 't',
            sourceBlockIds: ['b1'],
            provenance: 'source',
            fidelityRisk: 'low',
          },
          {
            id: 'b',
            type: 'paragraph',
            text: 't',
            sourceBlockIds: [],
            provenance: 'scaffold',
            fidelityRisk: 'low',
          },
        ],
      },
    ])
    expect(summary).toEqual({
      totalBlocks: 2,
      sourceGroundedBlocks: 1,
      scaffoldBlocks: 1,
      groundedPercent: 50,
    })
  })

  it('selects the learning shape from kind + concept density', () => {
    expect(selectShape('transcript', 0)).toBe('lesson')
    expect(selectShape('reference', 5)).toBe('reference_entry')
    expect(selectShape('structured_article', 3)).toBe('concept_explainer')
    expect(selectShape('structured_article', 1)).toBe('overview')
  })
})
