import {
  buildInterrogatorPrompt,
  MAX_QUESTIONS,
  parseQuestions,
} from './interrogator.prompt'

describe('parseQuestions', () => {
  it('parses a bare JSON array of {kind, question} objects', () => {
    const out = parseQuestions(
      '[{"kind":"central_claim","question":"What is the core claim?"},{"kind":"terminology","question":"Define X."}]',
    )
    expect(out).toEqual([
      { kind: 'central_claim', question: 'What is the core claim?' },
      { kind: 'terminology', question: 'Define X.' },
    ])
  })

  it('strips ```json code fences', () => {
    const out = parseQuestions('```json\n[{"question":"Why?"}]\n```')
    expect(out).toEqual([{ kind: null, question: 'Why?' }])
  })

  it('survives valid array followed by trailing prose containing a "]"', () => {
    // The regression the greedy lastIndexOf(']') parser failed on.
    const out = parseQuestions(
      '["First question?","Second question?"] — let me know if you want more [examples]',
    )
    expect(out).toEqual([
      { kind: null, question: 'First question?' },
      { kind: null, question: 'Second question?' },
    ])
  })

  it('accepts an envelope object {questions: [...]}', () => {
    const out = parseQuestions(
      '{"questions":[{"question":"What assumption?"}]}',
    )
    expect(out).toEqual([{ kind: null, question: 'What assumption?' }])
  })

  it('coerces an unknown kind to null', () => {
    const out = parseQuestions('[{"kind":"banana","question":"Q?"}]')
    expect(out).toEqual([{ kind: null, question: 'Q?' }])
  })

  it('drops empty questions and returns [] on garbage', () => {
    expect(parseQuestions('[{"question":"   "},{"question":"Real?"}]')).toEqual(
      [{ kind: null, question: 'Real?' }],
    )
    expect(parseQuestions('the model said no')).toEqual([])
    expect(parseQuestions('')).toEqual([])
  })

  it('truncates absurdly long questions', () => {
    const long = 'q'.repeat(1000)
    const [only] = parseQuestions(`[{"question":"${long}"}]`)
    expect(only.question.length).toBe(500)
  })
})

describe('buildInterrogatorPrompt', () => {
  it('uses a connection angle and names related concepts when familiar', () => {
    const { prompt } = buildInterrogatorPrompt({
      source: 'some text',
      relatedTitles: ['Spaced repetition'],
      familiar: true,
    })
    expect(prompt).toContain('Spaced repetition')
    expect(prompt).toContain('connects to')
  })

  it('uses a foundational angle when novel', () => {
    const { prompt } = buildInterrogatorPrompt({
      source: 'some text',
      relatedTitles: [],
      familiar: false,
    })
    expect(prompt).toContain('new topic')
  })

  it('caps the source material fed to the model', () => {
    const { prompt } = buildInterrogatorPrompt({
      source: 'x'.repeat(10_000),
      relatedTitles: [],
      familiar: false,
    })
    // 6000-char cap + surrounding template, never the full 10k.
    expect(prompt).not.toContain('x'.repeat(6001))
  })

  it('exposes a sane question band', () => {
    expect(MAX_QUESTIONS).toBe(5)
  })
})
