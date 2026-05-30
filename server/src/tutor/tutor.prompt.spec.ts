import { buildTutorPrompt, parseTutorQuestion } from './tutor.prompt'

describe('parseTutorQuestion', () => {
  it('returns a plain-text question unchanged', () => {
    expect(parseTutorQuestion('Why is this claim true?')).toBe(
      'Why is this claim true?',
    )
  })

  it('strips a wrapping code fence', () => {
    const out = parseTutorQuestion('```\nWhy does this hold?\n```')
    expect(out).toBe('Why does this hold?')
  })

  it('strips wrapping quotes', () => {
    expect(parseTutorQuestion('"What breaks if X is false?"')).toBe(
      'What breaks if X is false?',
    )
  })

  it('reads a {"question": "..."} envelope', () => {
    const out = parseTutorQuestion(
      '{"question": "What is the mechanism here?"}',
    )
    expect(out).toBe('What is the mechanism here?')
  })

  it('takes only the first line so an appended model answer is dropped', () => {
    const out = parseTutorQuestion(
      'Why is this true?\nAnswer: because the premise guarantees it.',
    )
    expect(out).toBe('Why is this true?')
    expect(out).not.toContain('Answer')
    expect(out).not.toContain('because the premise')
  })

  it('returns null on empty output', () => {
    expect(parseTutorQuestion('')).toBeNull()
    expect(parseTutorQuestion('   \n  ')).toBeNull()
  })
})

describe('buildTutorPrompt', () => {
  it('forbids answering and grading in the system prompt', () => {
    const { system } = buildTutorPrompt({
      title: 'Compound interest',
      articulation: 'Money grows faster over time.',
      angle: 'why',
    })
    expect(system).toContain('Do NOT answer')
    expect(system).toContain('Do NOT grade')
  })

  it('fences the articulation as untrusted', () => {
    const { prompt } = buildTutorPrompt({
      title: 'Compound interest',
      articulation: 'Money grows faster over time.',
      angle: 'why',
    })
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('Money grows faster over time.')
  })

  it('injects the instruction for a known angle', () => {
    const why = buildTutorPrompt({
      title: 'T',
      articulation: 'A',
      angle: 'why',
    })
    const counterexample = buildTutorPrompt({
      title: 'T',
      articulation: 'A',
      angle: 'counterexample',
    })
    expect(why.prompt).toContain('justify WHY')
    expect(counterexample.prompt).toContain('counter-example')
    expect(why.prompt).not.toBe(counterexample.prompt)
  })
})
