import { validateClusters } from './fidelity-clusters.util'
import type { SourceStructureModel } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
} from './transformer.types'

/** A classified source block (order in the array = source order). */
function block(
  id: string,
  text: string,
  classification = 'MAIN_ARGUMENT',
): ClassifiedBlockInput {
  return { id, type: 'PARAGRAPH', classification, text, removable: false }
}

const para = (id: string, text: string, ids: string[]): ArticleBlock => ({
  id,
  type: 'paragraph',
  text,
  sourceBlockIds: ids,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

function section(
  id: string,
  ids: string[],
  blocks: ArticleBlock[],
): ArticleSectionV2 {
  return {
    id,
    heading: id,
    headingSource: 'inferred',
    sourceBlockIds: ids,
    blocks,
  }
}

function article(sections: ArticleSectionV2[]): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections,
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
  }
}

function model(partial: Partial<SourceStructureModel>): SourceStructureModel {
  return {
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
    ...partial,
  }
}

describe('validateClusters — claim/caveat separation', () => {
  const blocks = [
    block('b1', 'Fasting reliably produces weight loss.'),
    block('b2', 'But only when total calories also fall.'),
    block('b3', 'The trials ran twelve weeks.'),
  ]
  const sm = model({
    claims: [
      {
        text: 'Fasting reliably produces weight loss.',
        sourceBlockIds: ['b1'],
      },
    ],
    caveats: [
      {
        text: 'But only when total calories also fall.',
        sourceBlockIds: ['b2'],
      },
    ],
  })

  it('passes when the caveat sits next to its claim', () => {
    const a = article([
      section('s1', ['b1'], [para('p1', 'claim', ['b1'])]),
      section('s2', ['b2'], [para('p2', 'caveat', ['b2'])]),
    ])
    const out = validateClusters(a, sm, blocks)
    expect(out.structuralFindings).toEqual([])
  })

  it('blocks when the caveat is pushed far from its claim', () => {
    const a = article([
      section('s1', ['b1'], [para('p1', 'claim', ['b1'])]),
      section('s2', ['b3'], [para('p3', 'trials', ['b3'])]),
      section('s3', ['b2'], [para('p2', 'caveat', ['b2'])]),
    ])
    const out = validateClusters(a, sm, blocks)
    expect(out.structuralFindings.some((f) => f.severity === 'high')).toBe(true)
    expect(
      out.structuralFindings.some((f) =>
        /separated from the claim/.test(f.description),
      ),
    ).toBe(true)
  })

  it('blocks when the claim renders but the anchored caveat renders nowhere', () => {
    const a = article([section('s1', ['b1'], [para('p1', 'claim', ['b1'])])])
    const out = validateClusters(a, sm, blocks)
    expect(out.structuralFindings.some((f) => f.severity === 'high')).toBe(true)
    expect(
      out.structuralFindings.some((f) =>
        /not rendered anywhere/.test(f.description),
      ),
    ).toBe(true)
  })

  it('does NOT anchor a caveat that is not source-adjacent to the claim', () => {
    // Caveat cites b3 (gap of 2 from the claim's b1 → within adjacency=2), so to
    // make it non-adjacent we need a larger gap.
    const farBlocks = [
      block('b1', 'claim'),
      block('x1', 'noise'),
      block('x2', 'noise'),
      block('x3', 'noise'),
      block('b2', 'unrelated caveat'),
    ]
    const farModel = model({
      claims: [{ text: 'claim', sourceBlockIds: ['b1'] }],
      caveats: [{ text: 'unrelated caveat', sourceBlockIds: ['b2'] }],
    })
    const a = article([section('s1', ['b1'], [para('p1', 'claim', ['b1'])])])
    const out = validateClusters(a, farModel, farBlocks)
    expect(out.structuralFindings).toEqual([])
  })
})

describe('validateClusters — evidence separation', () => {
  it('blocks when EVIDENCE is far from the claim it is adjacent to in source', () => {
    const blocks = [
      block('b1', 'claim', 'MAIN_ARGUMENT'),
      block('b2', 'a supporting study result', 'EVIDENCE'),
      block('b3', 'filler', 'BACKGROUND'),
    ]
    const sm = model({
      claims: [{ text: 'claim', sourceBlockIds: ['b1'] }],
    })
    const a = article([
      section('s1', ['b1'], [para('p1', 'claim', ['b1'])]),
      section('s2', ['b3'], [para('p3', 'filler', ['b3'])]),
      section('s3', ['b2'], [para('p2', 'evidence', ['b2'])]),
    ])
    const out = validateClusters(a, sm, blocks)
    expect(
      out.structuralFindings.some((f) => /Evidence block/.test(f.description)),
    ).toBe(true)
  })

  it('passes when EVIDENCE renders next to its claim', () => {
    const blocks = [
      block('b1', 'claim', 'MAIN_ARGUMENT'),
      block('b2', 'a supporting study result', 'EVIDENCE'),
    ]
    const sm = model({ claims: [{ text: 'claim', sourceBlockIds: ['b1'] }] })
    const a = article([
      section('s1', ['b1'], [para('p1', 'claim', ['b1'])]),
      section('s2', ['b2'], [para('p2', 'evidence', ['b2'])]),
    ])
    expect(validateClusters(a, sm, blocks).structuralFindings).toEqual([])
  })
})

describe('validateClusters — chronology inversion (conservative)', () => {
  it('flags a heavy backwards reading order through a date-dense source', () => {
    const blocks = [
      block('b1', 'In January 2020 the project started.'),
      block('b2', 'Then in 2021 the team grew.'),
      block('b3', 'Finally in 2022 it shipped.'),
    ]
    const sm = model({})
    // Reading order renders b3, then b2, then b1 — fully inverted.
    const a = article([
      section('s1', ['b3'], [para('p3', 'shipped', ['b3'])]),
      section('s2', ['b2'], [para('p2', 'grew', ['b2'])]),
      section('s3', ['b1'], [para('p1', 'started', ['b1'])]),
    ])
    const out = validateClusters(a, sm, blocks)
    expect(out.emphasisChanges.some((f) => f.severity === 'high')).toBe(true)
  })

  it('does NOT flag inversion when the source has no chronology markers', () => {
    const blocks = [
      block('b1', 'Apples are red.'),
      block('b2', 'Oranges are orange.'),
      block('b3', 'Bananas are yellow.'),
    ]
    const sm = model({})
    const a = article([
      section('s1', ['b3'], [para('p3', 'b', ['b3'])]),
      section('s2', ['b2'], [para('p2', 'o', ['b2'])]),
      section('s3', ['b1'], [para('p1', 'a', ['b1'])]),
    ])
    expect(validateClusters(a, sm, blocks).emphasisChanges).toEqual([])
  })

  it('does NOT flag a source-ordered, date-dense article', () => {
    const blocks = [
      block('b1', 'In January 2020 the project started.'),
      block('b2', 'Then in 2021 the team grew.'),
      block('b3', 'Finally in 2022 it shipped.'),
    ]
    const sm = model({})
    const a = article([
      section('s1', ['b1'], [para('p1', 'started', ['b1'])]),
      section('s2', ['b2'], [para('p2', 'grew', ['b2'])]),
      section('s3', ['b3'], [para('p3', 'shipped', ['b3'])]),
    ])
    expect(validateClusters(a, sm, blocks).emphasisChanges).toEqual([])
  })
})

describe('validateClusters — W10 forward-compat', () => {
  it('accepts an optional reorderings array without changing the deterministic result', () => {
    const blocks = [block('b1', 'claim'), block('b2', 'caveat')]
    const sm = model({
      claims: [{ text: 'claim', sourceBlockIds: ['b1'] }],
      caveats: [{ text: 'caveat', sourceBlockIds: ['b2'] }],
    })
    const a = article([
      section('s1', ['b1'], [para('p1', 'claim', ['b1'])]),
      section('s2', ['b2'], [para('p2', 'caveat', ['b2'])]),
    ])
    const withOpt = validateClusters(a, sm, blocks, {
      reorderings: [
        {
          sourceBlockId: 'b2',
          fromIndex: 1,
          toIndex: 1,
          reason: 'kept beside its claim',
          risk: 'low',
        },
      ],
    })
    const without = validateClusters(a, sm, blocks)
    expect(withOpt).toEqual(without)
  })
})
