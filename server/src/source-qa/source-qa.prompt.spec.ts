import {
  buildAnswerPrompt,
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
  it('parses a clean JSON object with citations', () => {
    const out = parseAnswer(
      '{"answer": "The source defines X as Y.", "citations": ["X is Y"]}',
    )
    expect(out).toEqual({
      answer: 'The source defines X as Y.',
      citations: ['X is Y'],
    })
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
      '{"answer": "A", "citations": ["q"]}\n\nHope that helps!',
    )
    expect(out?.answer).toBe('A')
    expect(out?.citations).toEqual(['q'])
  })

  it('falls back to plain text when there is no JSON', () => {
    const out = parseAnswer('The source says the sky is blue.')
    expect(out).toEqual({
      answer: 'The source says the sky is blue.',
      citations: [],
    })
  })

  it('drops non-string citations and caps the count', () => {
    const out = parseAnswer(
      JSON.stringify({
        answer: 'ok',
        citations: ['a', 2, null, 'b', 'c', 'd', 'e', 'f', 'g'],
      }),
    )
    expect(out?.citations).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('returns null on empty / unusable input', () => {
    expect(parseAnswer('')).toBeNull()
    expect(parseAnswer('   ')).toBeNull()
  })

  it('treats an object with a blank answer as having no JSON answer', () => {
    // No usable `answer` field → falls back to the whole text as the answer.
    const out = parseAnswer('{"answer": "   ", "citations": ["x"]}')
    expect(out?.answer).toContain('"citations"')
  })

  it('caps an over-long answer', () => {
    const huge = 'x'.repeat(MAX_ANSWER_CHARS + 500)
    const out = parseAnswer(JSON.stringify({ answer: huge, citations: [] }))
    expect(out?.answer.length).toBe(MAX_ANSWER_CHARS)
  })
})
