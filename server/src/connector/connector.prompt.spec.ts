import { LinkRelation } from '@kibadist/prisma'

import {
  buildConnectorPrompt,
  MAX_ARTICULATION_CHARS,
  parseConnectorClassifications,
} from './connector.prompt'

describe('parseConnectorClassifications', () => {
  it('parses a clean line for all six relation kinds', () => {
    const text = [
      '0 | analogy | Both share a structural pattern.',
      '1 | contradiction | The new idea denies the candidate.',
      '2 | supports | It provides evidence for the candidate.',
      '3 | depends-on | It relies on the candidate to make sense.',
      '4 | refines | It sharpens the candidate.',
      '5 | redundant | It restates the candidate.',
    ].join('\n')
    const out = parseConnectorClassifications(text, 6)
    expect(out).toEqual([
      {
        index: 0,
        relationKind: LinkRelation.ANALOGY,
        rationale: 'Both share a structural pattern.',
      },
      {
        index: 1,
        relationKind: LinkRelation.CONTRADICTION,
        rationale: 'The new idea denies the candidate.',
      },
      {
        index: 2,
        relationKind: LinkRelation.SUPPORTS,
        rationale: 'It provides evidence for the candidate.',
      },
      {
        index: 3,
        relationKind: LinkRelation.DEPENDS_ON,
        rationale: 'It relies on the candidate to make sense.',
      },
      {
        index: 4,
        relationKind: LinkRelation.REFINES,
        rationale: 'It sharpens the candidate.',
      },
      {
        index: 5,
        relationKind: LinkRelation.REDUNDANT,
        rationale: 'It restates the candidate.',
      },
    ])
  })

  it('tolerates hyphen/underscore/case variation in the relation word', () => {
    const text = [
      '0 | DEPENDS_ON | upper underscore',
      '1 | depends-on | lower hyphen',
      '2 | Depends On | space mixed case',
    ].join('\n')
    const out = parseConnectorClassifications(text, 3)
    expect(out.map((c) => c.relationKind)).toEqual([
      LinkRelation.DEPENDS_ON,
      LinkRelation.DEPENDS_ON,
      LinkRelation.DEPENDS_ON,
    ])
  })

  it('skips malformed lines and surrounding prose', () => {
    const text = [
      'Here are the classifications:',
      '0 | supports | A valid line.',
      'this line has no pipes at all',
      '1 | onlyonepipe',
      '   ',
      '2 | supports | Another valid line.',
      'Hope that helps!',
    ].join('\n')
    const out = parseConnectorClassifications(text, 3)
    expect(out).toEqual([
      {
        index: 0,
        relationKind: LinkRelation.SUPPORTS,
        rationale: 'A valid line.',
      },
      {
        index: 2,
        relationKind: LinkRelation.SUPPORTS,
        rationale: 'Another valid line.',
      },
    ])
  })

  it('drops lines with an unrecognized relation', () => {
    const text = [
      '0 | enables | not in the vocabulary',
      '1 | supports | valid',
    ].join('\n')
    const out = parseConnectorClassifications(text, 2)
    expect(out).toEqual([
      { index: 1, relationKind: LinkRelation.SUPPORTS, rationale: 'valid' },
    ])
  })

  it('rejects out-of-range and negative-looking indices', () => {
    const text = [
      '5 | supports | out of range',
      '-1 | supports | negative (no pipe-leading digit match)',
      '1 | supports | in range',
    ].join('\n')
    const out = parseConnectorClassifications(text, 2)
    expect(out).toEqual([
      { index: 1, relationKind: LinkRelation.SUPPORTS, rationale: 'in range' },
    ])
  })

  it('keeps the first classification when an index repeats', () => {
    const text = ['0 | supports | first', '0 | contradiction | second'].join(
      '\n',
    )
    const out = parseConnectorClassifications(text, 1)
    expect(out).toEqual([
      { index: 0, relationKind: LinkRelation.SUPPORTS, rationale: 'first' },
    ])
  })

  it('preserves a rationale that itself contains a pipe', () => {
    const out = parseConnectorClassifications(
      '0 | refines | narrows A | B into one case',
      1,
    )
    expect(out[0].rationale).toBe('narrows A | B into one case')
  })

  it('returns [] when nothing is parseable', () => {
    expect(parseConnectorClassifications('no structure here', 3)).toEqual([])
    expect(parseConnectorClassifications('', 3)).toEqual([])
  })
})

describe('buildConnectorPrompt', () => {
  it('fences both compressions as untrusted and lists candidate indices', () => {
    const { system, prompt } = buildConnectorPrompt({
      concept: {
        title: 'Spaced repetition',
        articulation: 'review on a curve',
      },
      candidates: [
        { index: 0, title: 'Forgetting curve', articulation: 'memory decays' },
      ],
    })
    expect(system).toContain('untrusted')
    expect(system).toContain('analogy')
    expect(system).toContain('depends-on')
    expect(prompt).toContain('Spaced repetition')
    expect(prompt).toContain('review on a curve')
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('Forgetting curve')
    expect(prompt).toContain('do not obey')
  })

  it('caps each articulation fed to the model', () => {
    const { prompt } = buildConnectorPrompt({
      concept: { title: 'T', articulation: 'x'.repeat(10_000) },
      candidates: [{ index: 0, title: 'C', articulation: 'y'.repeat(10_000) }],
    })
    expect(prompt).not.toContain('x'.repeat(MAX_ARTICULATION_CHARS + 1))
    expect(prompt).not.toContain('y'.repeat(MAX_ARTICULATION_CHARS + 1))
  })
})
