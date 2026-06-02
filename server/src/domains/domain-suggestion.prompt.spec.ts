import {
  buildDomainSuggestionPrompt,
  parseDomainSuggestions,
} from './domain-suggestion.prompt'

describe('buildDomainSuggestionPrompt', () => {
  it('numbers domains and frames concept + domains as untrusted', () => {
    const { system, prompt } = buildDomainSuggestionPrompt({
      concept: { title: 'Raft', articulation: 'A consensus algorithm.' },
      domains: [
        { index: 0, name: 'Distributed Systems', description: 'Coordination.' },
        { index: 1, name: 'Cooking', description: null },
      ],
    })

    expect(system).toContain('Domain Classifier')
    expect(prompt).toContain('[0] "Distributed Systems" — Coordination.')
    // A domain without a description renders without the trailing dash clause.
    expect(prompt).toContain('[1] "Cooking"')
    expect(prompt).not.toContain('[1] "Cooking" —')
    expect(prompt).toContain('untrusted')
  })
})

describe('parseDomainSuggestions', () => {
  it('parses index | confidence | rationale lines', () => {
    const out = parseDomainSuggestions(
      '0 | 0.82 | Consensus protocol.\n2 | 0.4 | Tangentially related.',
      3,
    )
    expect(out).toEqual([
      { index: 0, confidence: 0.82, rationale: 'Consensus protocol.' },
      { index: 2, confidence: 0.4, rationale: 'Tangentially related.' },
    ])
  })

  it('drops out-of-range indices, dupes, and clamps confidence to [0,1]', () => {
    const out = parseDomainSuggestions(
      '0 | 1.5 | over-confident\n0 | 0.9 | duplicate index\n9 | 0.5 | out of range\nfoo | 0.5 | non-numeric',
      3,
    )
    // Only the first index-0 line survives; confidence clamps 1.5 → 1.
    expect(out).toEqual([
      { index: 0, confidence: 1, rationale: 'over-confident' },
    ])
  })

  it('returns [] when the model assigns no domains (none apply)', () => {
    expect(parseDomainSuggestions('', 3)).toEqual([])
    expect(parseDomainSuggestions('No domains apply.', 3)).toEqual([])
  })

  it('ignores lines missing a rationale or second pipe', () => {
    expect(parseDomainSuggestions('0 | 0.9', 3)).toEqual([])
    expect(parseDomainSuggestions('0 | 0.9 | ', 3)).toEqual([])
  })
})
