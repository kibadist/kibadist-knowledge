import { generateCards, type RetrievalCard } from './cards'

const typesOf = (cards: RetrievalCard[]) => cards.map((c) => c.type)

describe('generateCards', () => {
  it('always includes EXPLAIN and BOUNDARY', () => {
    const cards = generateCards({
      title: 'Spaced repetition',
      articulation:
        'Reviewing material at increasing intervals improves recall.',
    })
    expect(typesOf(cards)).toContain('EXPLAIN')
    expect(typesOf(cards)).toContain('BOUNDARY')
  })

  it('every card is marked fromCompression', () => {
    const cards = generateCards({
      title: 'Spaced repetition',
      articulation:
        'Reviewing material at increasing intervals improves recall.',
      edges: [{ targetTitle: 'Forgetting curve', relationKind: 'SUPPORTS' }],
    })
    expect(cards.every((c) => c.fromCompression === true)).toBe(true)
  })

  it('CLOZE blanks a salient (long, non-stopword) term and sets that as the answer', () => {
    const cards = generateCards({
      title: 'Spaced repetition',
      articulation:
        'Reviewing material at increasing intervals improves recall.',
    })
    const cloze = cards.find((c) => c.type === 'CLOZE')
    expect(cloze).toBeDefined()
    // The longest non-stopword token here is "increasing".
    expect(cloze?.answer).toBe('increasing')
    expect(cloze?.prompt).toContain('_____')
    expect(cloze?.prompt.toLowerCase()).not.toContain('increasing')
  })

  it('CONNECT appears only when an edge with a targetTitle is passed and names it', () => {
    const without = generateCards({
      title: 'Spaced repetition',
      articulation: 'Reviewing at intervals improves recall.',
    })
    expect(typesOf(without)).not.toContain('CONNECT')

    const withEdge = generateCards({
      title: 'Spaced repetition',
      articulation: 'Reviewing at intervals improves recall.',
      edges: [{ targetTitle: 'Forgetting curve', relationKind: 'SUPPORTS' }],
    })
    const connect = withEdge.find((c) => c.type === 'CONNECT')
    expect(connect).toBeDefined()
    expect(connect?.prompt).toContain('Forgetting curve')
  })

  it('a tiny/stopword-only articulation still yields ≥1 card and no CLOZE', () => {
    const cards = generateCards({ title: 'It', articulation: 'the and of to' })
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(typesOf(cards)).not.toContain('CLOZE')
    expect(typesOf(cards)).toContain('EXPLAIN')
  })
})
