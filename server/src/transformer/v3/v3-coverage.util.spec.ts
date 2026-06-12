import {
  ARTICLE_SCHEMA_VERSION_V3,
  type ArticleJsonV3,
  type ArticleSectionV3,
} from './v3.types'
import {
  buildImportantCoverage,
  type CoverageBlockV3,
  isImportantBlock,
} from './v3-coverage.util'

/** A minimal v3 article whose sections cite the given block ids. */
function articleCiting(...sectionBlockIds: string[][]): ArticleJsonV3 {
  const sections: ArticleSectionV3[] = sectionBlockIds.map((ids, i) => ({
    id: `sec-${i}`,
    heading: `H${i}`,
    headingProvenance: 'scaffold',
    sourceBlockIds: ids,
    blocks: ids.map((id, bi) => ({
      id: `sec-${i}-b-${bi}`,
      type: 'paragraph' as const,
      text: 't',
      sourceBlockIds: [id],
      provenance: 'source' as const,
      fidelityRisk: 'low' as const,
    })),
  }))
  return {
    schemaVersion: ARTICLE_SCHEMA_VERSION_V3,
    sourceKind: 'structured_article',
    shape: 'overview',
    title: { text: 'T', provenance: 'scaffold' },
    summary: { text: 'S', provenance: 'scaffold' },
    sections,
    learning: {
      learningPath: [],
      keyConcepts: [],
      keyClaims: [],
      retrievalPrompts: [],
      sourceNotes: [],
    },
    provenance: {
      totalBlocks: 0,
      sourceGroundedBlocks: 0,
      scaffoldBlocks: 0,
      groundedPercent: 100,
    },
  }
}

const block = (
  id: string,
  classification: string | null,
  removable = false,
): CoverageBlockV3 => ({ id, classification, removable })

describe('isImportantBlock (DET-343)', () => {
  it('counts non-removable substance blocks as important', () => {
    expect(isImportantBlock(block('b1', 'DEFINITION'))).toBe(true)
    expect(isImportantBlock(block('b2', 'MAIN_ARGUMENT'))).toBe(true)
  })
  it('excludes noise, removable, and unclassified blocks', () => {
    expect(isImportantBlock(block('b3', 'NAVIGATION_NOISE'))).toBe(false)
    expect(isImportantBlock(block('b4', 'DEFINITION', true))).toBe(false)
    expect(isImportantBlock(block('b5', null))).toBe(false)
  })
})

describe('buildImportantCoverage (DET-343)', () => {
  it('measures coverage over important blocks only, ignoring noise', () => {
    // 2 important (b1, b2); b3 is noise. Article cites only b1 → 50%.
    const coverage = buildImportantCoverage(articleCiting(['b1']), [
      block('b1', 'DEFINITION'),
      block('b2', 'EVIDENCE'),
      block('b3', 'NAVIGATION_NOISE'),
    ])
    expect(coverage.importantTotal).toBe(2)
    expect(coverage.importantCoveragePercent).toBe(50)
    expect(coverage.representedImportantIds).toEqual(['b1'])
    expect(coverage.missingImportantIds).toEqual(['b2'])
  })

  it('reaches 100% when every important block is cited (noise uncited is fine)', () => {
    const coverage = buildImportantCoverage(articleCiting(['b1'], ['b2']), [
      block('b1', 'DEFINITION'),
      block('b2', 'METHOD'),
      block('b3', 'FOOTER', true),
    ])
    expect(coverage.importantCoveragePercent).toBe(100)
  })

  it('is vacuously 100% when the source has no important blocks', () => {
    const coverage = buildImportantCoverage(articleCiting([]), [
      block('b1', 'NAVIGATION_NOISE'),
    ])
    expect(coverage.importantTotal).toBe(0)
    expect(coverage.importantCoveragePercent).toBe(100)
  })

  it('counts citations from the learning layer, not just sections', () => {
    const article = articleCiting([])
    article.learning.keyConcepts.push({
      id: 'concept-0',
      label: 'X',
      definition: 'd',
      sourceBlockIds: ['b1'],
      aiAssisted: true,
    })
    const coverage = buildImportantCoverage(article, [
      block('b1', 'DEFINITION'),
    ])
    expect(coverage.importantCoveragePercent).toBe(100)
  })
})
