import { makeV3Article } from './__fixtures__/v3-fixtures'
import {
  buildImportantCoverageV3,
  type CoverageBlockV3,
  citedBlockIdsV3,
  isImportantBlock,
} from './v3-coverage.util'

describe('v3 important-source coverage', () => {
  it('counts only non-removable substance blocks as important', () => {
    expect(
      isImportantBlock({
        id: 'a',
        classification: 'DEFINITION',
        removable: false,
      }),
    ).toBe(true)
    expect(
      isImportantBlock({
        id: 'b',
        classification: 'DEFINITION',
        removable: true,
      }),
    ).toBe(false)
    expect(
      isImportantBlock({
        id: 'c',
        classification: 'NAVIGATION_NOISE',
        removable: false,
      }),
    ).toBe(false)
  })

  it('collects cited block ids across body + learning layer', () => {
    const article = makeV3Article({
      keyConcepts: [
        {
          id: 'concept-0',
          name: 'X',
          normalizedName: 'x',
          type: 'core_concept',
          sourceBlockIds: ['b9'],
          articleSectionIds: [],
          importance: 'high',
          suggestedCognitiveState: 'Parsed',
        },
      ],
    })
    const cited = citedBlockIdsV3(article)
    expect(cited.has('b1')).toBe(true) // section paragraph
    expect(cited.has('b9')).toBe(true) // concept
  })

  it('is vacuously 100% when there are no important blocks', () => {
    const blocks: CoverageBlockV3[] = [
      { id: 'b2', classification: 'NAVIGATION_NOISE', removable: true },
    ]
    const cov = buildImportantCoverageV3(makeV3Article(), blocks)
    expect(cov.importantTotal).toBe(0)
    expect(cov.importantCoveragePercent).toBe(100)
  })

  it('partitions represented vs missing important blocks', () => {
    const blocks: CoverageBlockV3[] = [
      { id: 'b1', classification: 'DEFINITION', removable: false },
      { id: 'b5', classification: 'EVIDENCE', removable: false },
    ]
    const cov = buildImportantCoverageV3(makeV3Article(), blocks)
    expect(cov.representedImportantIds).toEqual(['b1'])
    expect(cov.missingImportantIds).toEqual(['b5'])
    expect(cov.importantCoveragePercent).toBe(50)
  })
})
