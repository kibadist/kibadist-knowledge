import { type DiagnosisBlock, diagnoseSource } from './source-kind.util'

const P = (text: string): DiagnosisBlock => ({ blockType: 'PARAGRAPH', text })
const H = (text: string): DiagnosisBlock => ({ blockType: 'HEADING', text })
const L = (text: string): DiagnosisBlock => ({ blockType: 'LIST', text })

describe('diagnoseSource (DET-343)', () => {
  it('returns mixed for an empty source', () => {
    expect(diagnoseSource([]).kind).toBe('mixed')
  })

  it('detects a spoken transcript from filler + no headings', () => {
    const blocks: DiagnosisBlock[] = [
      P("Okay so in this video we're gonna look at how memory works, right?"),
      P(
        'So you know, the thing is, um, the heap is kind of where objects live.',
      ),
      P("And I mean, let's say you allocate something, it's gonna sit there."),
      P(
        'So basically, you know, garbage collection is what cleans that up later.',
      ),
    ]
    expect(diagnoseSource(blocks).kind).toBe('transcript')
  })

  it('detects a structured article from headings + lists', () => {
    const blocks: DiagnosisBlock[] = [
      H('Introduction'),
      P('Distributed systems coordinate work across many machines.'),
      H('Consistency models'),
      P('A consistency model defines the guarantees reads observe.'),
      L('Strong consistency'),
      L('Eventual consistency'),
      H('Conclusion'),
      P('Choosing a model is a tradeoff between latency and guarantees.'),
    ]
    expect(diagnoseSource(blocks).kind).toBe('structured_article')
  })

  it('detects reference material from definitional density', () => {
    const blocks: DiagnosisBlock[] = [
      P(
        'Idempotence is defined as the property where repeating an operation yields the same result.',
      ),
      P(
        'A mutex refers to a mutual-exclusion lock guarding a critical section.',
      ),
      P('Throughput is a type of measure of work completed per unit time.'),
      P('Latency is defined as the time between a request and its response.'),
    ]
    expect(diagnoseSource(blocks).kind).toBe('reference')
  })

  it('falls back to mixed when no signal dominates', () => {
    const blocks: DiagnosisBlock[] = [
      P('The weather was pleasant and the team met for lunch.'),
      P('They discussed the roadmap and then went their separate ways.'),
    ]
    expect(diagnoseSource(blocks).kind).toBe('mixed')
  })

  it('exposes the signals that drove the pick', () => {
    const d = diagnoseSource([H('A'), P('x'), H('B'), P('y')])
    expect(d.headingRatio).toBeCloseTo(0.5)
    expect(typeof d.reason).toBe('string')
  })
})
