import { parseLivingConceptDraft } from './living-concept.prompt'

describe('parseLivingConceptDraft', () => {
  const valid = {
    personaName: 'The Cache',
    personaSummary: 'I hold what was just needed, and I forget on a timer.',
    voice: 'terse, exact',
    coreMetaphor: 'a desk you keep one paper on',
    metaphorBreaks: 'a desk does not evict its own papers; a cache does',
  }

  it('parses a bare JSON object', () => {
    const draft = parseLivingConceptDraft(JSON.stringify(valid))
    expect(draft).toMatchObject(valid)
  })

  it('parses JSON wrapped in markdown code fences', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``
    expect(parseLivingConceptDraft(fenced)).toMatchObject(valid)
  })

  it('parses JSON embedded in surrounding prose', () => {
    const prose = `Sure — here is the persona:\n${JSON.stringify(valid)}\nHope that helps.`
    expect(parseLivingConceptDraft(prose)).toMatchObject(valid)
  })

  it('returns null when the persona name is missing', () => {
    const noName = JSON.stringify({ ...valid, personaName: '   ' })
    expect(parseLivingConceptDraft(noName)).toBeNull()
  })

  it('returns null for output with no JSON object', () => {
    expect(parseLivingConceptDraft('no json here')).toBeNull()
  })

  it('truncates oversized fields to their defensive bounds', () => {
    const draft = parseLivingConceptDraft(
      JSON.stringify({
        personaName: 'n'.repeat(500),
        personaSummary: 's'.repeat(5000),
        voice: 'v'.repeat(5000),
        coreMetaphor: 'm'.repeat(5000),
        metaphorBreaks: 'b'.repeat(5000),
      }),
    )
    expect(draft).not.toBeNull()
    // MAX_NAME_CHARS=120, MAX_SUMMARY_CHARS=1200, MAX_SHORT_CHARS=600.
    expect(draft?.personaName).toHaveLength(120)
    expect(draft?.personaSummary).toHaveLength(1200)
    expect(draft?.voice).toHaveLength(600)
    expect(draft?.coreMetaphor).toHaveLength(600)
    expect(draft?.metaphorBreaks).toHaveLength(600)
  })

  it('nulls optional fields that are absent or blank, keeping name + summary', () => {
    const draft = parseLivingConceptDraft(
      JSON.stringify({
        personaName: 'The Cache',
        personaSummary: 'Short-lived by design.',
      }),
    )
    expect(draft).toMatchObject({
      personaName: 'The Cache',
      voice: null,
      coreMetaphor: null,
      metaphorBreaks: null,
    })
  })
})
