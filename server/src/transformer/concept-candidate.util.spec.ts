import {
  buildBlockToSectionIndex,
  dedupeArticleConceptCandidates,
  normalizeConceptName,
  sectionIdsForBlocks,
  toRelationshipType,
} from './concept-candidate.util'
import type { ArticleConceptCandidate } from './schemas'
import type { ArticleJsonV2 } from './transformer.types'

describe('normalizeConceptName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeConceptName('Query/Key/Value')).toBe('query key value')
    expect(normalizeConceptName('  Self-Attention  ')).toBe('self attention')
    expect(normalizeConceptName('Self Attention')).toBe('self attention')
  })

  it('strips diacritics so accented variants collapse', () => {
    expect(normalizeConceptName('Naïve Bayes')).toBe(
      normalizeConceptName('Naive Bayes'),
    )
  })

  it('is idempotent', () => {
    const once = normalizeConceptName('Open-System!')
    expect(normalizeConceptName(once)).toBe(once)
  })
})

describe('toRelationshipType', () => {
  it('accepts known kinds case-insensitively', () => {
    expect(toRelationshipType('PREREQUISITE_OF')).toBe('prerequisite_of')
    expect(toRelationshipType(' related_to ')).toBe('related_to')
  })
  it('returns null for unknown kinds', () => {
    expect(toRelationshipType('depends_on')).toBeNull()
    expect(toRelationshipType('')).toBeNull()
  })
})

function article(): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 's1',
        heading: 'One',
        headingSource: 'original',
        headingSourceBlockIds: ['bh'],
        sourceBlockIds: ['b1'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'x',
            sourceBlockIds: ['b1', 'b2'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
        subsections: [
          {
            id: 's1a',
            heading: 'Nested',
            headingSource: 'inferred',
            sourceBlockIds: ['b3'],
            blocks: [
              {
                id: 'p2',
                type: 'paragraph',
                text: 'y',
                sourceBlockIds: ['b3'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
  }
}

describe('buildBlockToSectionIndex / sectionIdsForBlocks', () => {
  it('maps blocks to the sections (and subsections) that cite them', () => {
    const index = buildBlockToSectionIndex(article())
    expect([...(index.get('b1') ?? [])]).toEqual(['s1'])
    expect([...(index.get('b2') ?? [])]).toEqual(['s1'])
    expect([...(index.get('bh') ?? [])]).toEqual(['s1']) // heading provenance
    expect([...(index.get('b3') ?? [])]).toEqual(['s1a']) // subsection owns its id
    expect(index.get('ghost')).toBeUndefined()
  })

  it('resolves a candidate block set to deduped section ids in stable order', () => {
    const index = buildBlockToSectionIndex(article())
    expect(sectionIdsForBlocks(index, ['b3', 'b1', 'b2'])).toEqual([
      's1a',
      's1',
    ])
    expect(sectionIdsForBlocks(index, ['ghost'])).toEqual([])
  })
})

function candidate(
  over: Partial<ArticleConceptCandidate> = {},
): ArticleConceptCandidate {
  return {
    id: 'id',
    name: 'Name',
    normalizedName: 'name',
    type: 'term',
    sourceBlockIds: ['b1'],
    articleSectionIds: ['s1'],
    importance: 'low',
    suggestedCognitiveState: 'Seen',
    eligibleForLibraryReview: false,
    aiAssisted: true,
    validationStatus: 'pending',
    ...over,
  }
}

describe('dedupeArticleConceptCandidates', () => {
  it('merges by normalizedName: unions provenance, maxes importance + state', () => {
    const out = dedupeArticleConceptCandidates([
      candidate({
        id: 'a',
        normalizedName: 'open system',
        sourceBlockIds: ['c5'],
        articleSectionIds: ['ss2'],
        importance: 'medium',
        suggestedCognitiveState: 'Seen',
      }),
      candidate({
        id: 'b',
        normalizedName: 'open system',
        sourceBlockIds: ['c5', 'c6'],
        articleSectionIds: ['ss2', 'ss3'],
        importance: 'high',
        suggestedCognitiveState: 'Parsed',
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceBlockIds).toEqual(['c5', 'c6'])
    expect(out[0].articleSectionIds).toEqual(['ss2', 'ss3'])
    expect(out[0].importance).toBe('high')
    expect(out[0].suggestedCognitiveState).toBe('Parsed')
    // Eligibility is recomputed from the merged (stronger) importance.
    expect(out[0].eligibleForLibraryReview).toBe(true)
  })

  it('keeps distinct concepts separate and preserves first-seen order', () => {
    const out = dedupeArticleConceptCandidates([
      candidate({ normalizedName: 'system' }),
      candidate({ normalizedName: 'boundary' }),
      candidate({ normalizedName: 'system' }),
    ])
    expect(out.map((c) => c.normalizedName)).toEqual(['system', 'boundary'])
  })

  it('unions relationship edges without duplicating', () => {
    const out = dedupeArticleConceptCandidates([
      candidate({
        normalizedName: 'feedback',
        relationshipCandidates: [
          { type: 'related_to', targetNormalizedName: 'output' },
        ],
      }),
      candidate({
        normalizedName: 'feedback',
        relationshipCandidates: [
          { type: 'related_to', targetNormalizedName: 'output' },
          { type: 'prerequisite_of', targetNormalizedName: 'homeostasis' },
        ],
      }),
    ])
    expect(out[0].relationshipCandidates).toHaveLength(2)
  })
})
