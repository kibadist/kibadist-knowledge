import {
  PROVENANCE_LABELS,
  type ProvenanceInput,
  resolveSourceConfidence,
} from './source-provenance'

function input(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    determinable: true,
    preservesArticleMeaning: true,
    articleHasSourceSupport: true,
    sourceSpanAvailable: true,
    addsUnsupportedClaim: false,
    ...overrides,
  }
}

describe('resolveSourceConfidence — DET-278 feedback rules', () => {
  it('preserves article meaning + article sourced + span available => source_supported', () => {
    expect(resolveSourceConfidence(input())).toBe('source_supported')
  })

  it('matches article but no source span => article_supported_source_unavailable', () => {
    expect(resolveSourceConfidence(input({ sourceSpanAvailable: false }))).toBe(
      'article_supported_source_unavailable',
    )
  })

  it('matches article but article itself is unsourced => article_supported_source_unavailable', () => {
    expect(
      resolveSourceConfidence(input({ articleHasSourceSupport: false })),
    ).toBe('article_supported_source_unavailable')
  })

  it('adds a claim not in article or source => unsupported_or_invented', () => {
    expect(resolveSourceConfidence(input({ addsUnsupportedClaim: true }))).toBe(
      'unsupported_or_invented',
    )
  })

  it('cannot determine support => needs_review (never a guess)', () => {
    expect(resolveSourceConfidence(input({ determinable: false }))).toBe(
      'needs_review',
    )
  })

  it('user-authored, does not match article, not invented => user_authored_unsourced', () => {
    expect(
      resolveSourceConfidence(
        input({ preservesArticleMeaning: false, addsUnsupportedClaim: false }),
      ),
    ).toBe('user_authored_unsourced')
  })

  it('undeterminable short-circuits even when a claim is invented', () => {
    expect(
      resolveSourceConfidence(
        input({ determinable: false, addsUnsupportedClaim: true }),
      ),
    ).toBe('needs_review')
  })

  it('invented short-circuits before article matching', () => {
    expect(
      resolveSourceConfidence(
        input({ preservesArticleMeaning: true, addsUnsupportedClaim: true }),
      ),
    ).toBe('unsupported_or_invented')
  })
})

describe('PROVENANCE_LABELS — three layers never collapsed', () => {
  it('keeps article and source as distinct labels', () => {
    expect(PROVENANCE_LABELS.article).not.toBe(PROVENANCE_LABELS.source)
  })

  it('exposes all four explicit labels', () => {
    expect(Object.values(PROVENANCE_LABELS)).toEqual([
      'Your rewrite',
      'Article explanation',
      'Original source',
      'AI feedback',
    ])
  })
})
