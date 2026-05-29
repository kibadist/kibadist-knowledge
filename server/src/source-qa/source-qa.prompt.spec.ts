import {
  buildAnswerPrompt,
  coerceCitations,
  MAX_ANSWER_CHARS,
  parseAnswer,
} from './source-qa.prompt'

describe('buildAnswerPrompt', () => {
  it('fences the source and question as untrusted', () => {
    const { system, prompt } = buildAnswerPrompt({
      source: 'The mitochondria is the powerhouse of the cell.',
      question: 'What is the central claim?',
    })
    expect(system).toMatch(/SCAFFOLD/)
    expect(system).toMatch(/Ground your answer in the provided SOURCE/i)
    expect(prompt).toMatch(/SOURCE \(untrusted/)
    expect(prompt).toMatch(/QUESTION \(untrusted/)
    expect(prompt).toContain('powerhouse of the cell')
  })
})

describe('parseAnswer', () => {
  it('parses a clean JSON object with object citations (DET-210)', () => {
    const out = parseAnswer(
      '{"answer":"A","citations":[{"quote":"q1","blockId":"b_x"}]}',
    )
    expect(out).toEqual({
      answer: 'A',
      citations: [{ quote: 'q1', blockId: 'b_x' }],
    })
  })

  it('parses legacy string citations as {quote} objects (no blockId)', () => {
    const out = parseAnswer('{"answer":"A","citations":["q1"]}')
    expect(out).toEqual({
      answer: 'A',
      citations: [{ quote: 'q1' }],
    })
  })

  it('strips leading/trailing brackets from blockId', () => {
    const out = parseAnswer(
      '{"answer":"A","citations":[{"quote":"text","blockId":"[b_x]"}]}',
    )
    expect(out?.citations[0].blockId).toBe('b_x')
  })

  it('accepts quote alias "text" for the quote field', () => {
    const out = parseAnswer(
      '{"answer":"A","citations":[{"text":"via text alias"}]}',
    )
    expect(out?.citations[0].quote).toBe('via text alias')
  })

  it('accepts blockId alias "block" for the blockId field', () => {
    const out = parseAnswer(
      '{"answer":"A","citations":[{"quote":"q","block":"b_y"}]}',
    )
    expect(out?.citations[0].blockId).toBe('b_y')
  })

  it('strips a json code fence', () => {
    const out = parseAnswer(
      '```json\n{"answer": "Grounded.", "citations": []}\n```',
    )
    expect(out?.answer).toBe('Grounded.')
    expect(out?.citations).toEqual([])
  })

  it('survives trailing prose after the object', () => {
    const out = parseAnswer(
      '{"answer": "A", "citations": [{"quote":"q"}]}\n\nHope that helps!',
    )
    expect(out?.answer).toBe('A')
    expect(out?.citations).toEqual([{ quote: 'q' }])
  })

  it('falls back to plain text when there is no JSON', () => {
    const out = parseAnswer('The source says the sky is blue.')
    expect(out).toEqual({
      answer: 'The source says the sky is blue.',
      citations: [],
    })
  })

  it('drops unusable citation entries (number, null) and caps the count', () => {
    // Mix of legacy strings and numbers/nulls; cap is MAX_CITATIONS (6)
    const out = parseAnswer(
      JSON.stringify({
        answer: 'ok',
        citations: ['a', 2, null, 'b', 'c', 'd', 'e', 'f', 'g'],
      }),
    )
    // Numbers and nulls are dropped; valid strings kept up to 6
    expect(out?.citations.every((c) => typeof c.quote === 'string')).toBe(true)
    expect(out?.citations.length).toBeLessThanOrEqual(6)
    const quotes = out?.citations.map((c) => c.quote)
    expect(quotes).toContain('a')
    expect(quotes).toContain('b')
  })

  it('returns null on empty / unusable input', () => {
    expect(parseAnswer('')).toBeNull()
    expect(parseAnswer('   ')).toBeNull()
  })

  it('treats an object with a blank answer as having no JSON answer', () => {
    // No usable `answer` field → falls back to the whole text as the answer.
    const out = parseAnswer('{"answer": "   ", "citations": [{"quote":"x"}]}')
    expect(out?.answer).toContain('"citations"')
  })

  it('caps an over-long answer at MAX_ANSWER_CHARS', () => {
    const huge = 'x'.repeat(MAX_ANSWER_CHARS + 500)
    const out = parseAnswer(JSON.stringify({ answer: huge, citations: [] }))
    expect(out?.answer.length).toBe(MAX_ANSWER_CHARS)
  })

  it('caps an over-long citation quote', () => {
    const longQuote = 'q'.repeat(500)
    const out = parseAnswer(
      JSON.stringify({ answer: 'A', citations: [{ quote: longQuote }] }),
    )
    // MAX_CITATION_CHARS is 300
    expect(out?.citations[0].quote.length).toBeLessThanOrEqual(300)
  })
})

describe('coerceCitations', () => {
  it('normalizes a stored string array (legacy) to {quote} objects', () => {
    const result = coerceCitations(['alpha', 'beta'])
    expect(result).toEqual([{ quote: 'alpha' }, { quote: 'beta' }])
  })

  it('normalizes a stored object array to ReferenceCitation shape', () => {
    const result = coerceCitations([{ quote: 'text', blockId: 'b_1' }])
    expect(result).toEqual([{ quote: 'text', blockId: 'b_1' }])
  })

  it('drops invalid entries (numbers, nulls)', () => {
    const result = coerceCitations([null, 42, { quote: 'valid' }])
    expect(result).toEqual([{ quote: 'valid' }])
  })

  it('returns empty array for non-array input', () => {
    expect(coerceCitations(null)).toEqual([])
    expect(coerceCitations(undefined)).toEqual([])
    expect(coerceCitations('string')).toEqual([])
    expect(coerceCitations({})).toEqual([])
  })

  it('returns empty array for empty array input', () => {
    expect(coerceCitations([])).toEqual([])
  })
})
