import { BlockIdFactory } from './block-id.util'

describe('BlockIdFactory – determinism across instances', () => {
  it('produces the same id for the same (type, text) from separate factory instances', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('paragraph', 'Hello world')).toBe(
      b.next('paragraph', 'Hello world'),
    )
  })

  it('produces different ids for different text with the same type', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('paragraph', 'Hello')).not.toBe(b.next('paragraph', 'World'))
  })

  it('produces different ids for same text with different type', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('heading', 'Title')).not.toBe(b.next('paragraph', 'Title'))
  })
})

describe('BlockIdFactory – id format', () => {
  it('every id starts with b_', () => {
    const factory = new BlockIdFactory()
    expect(factory.next('paragraph', 'some text')).toMatch(/^b_/)
    expect(factory.next('heading', 'Title')).toMatch(/^b_/)
    expect(factory.next('code', 'const x = 1')).toMatch(/^b_/)
  })
})

describe('BlockIdFactory – duplicate disambiguation within one factory', () => {
  it('first occurrence keeps the bare b_<hash> form', () => {
    const factory = new BlockIdFactory()
    const first = factory.next('paragraph', 'Note:')
    expect(first).toMatch(/^b_[a-z0-9]+$/)
  })

  it('second occurrence of the same (type, text) gets a distinct id', () => {
    const factory = new BlockIdFactory()
    const first = factory.next('paragraph', 'Note:')
    const second = factory.next('paragraph', 'Note:')
    expect(second).not.toBe(first)
  })

  it('second occurrence id has a suffix ordinal', () => {
    const factory = new BlockIdFactory()
    const first = factory.next('paragraph', 'Repeat')
    const second = factory.next('paragraph', 'Repeat')
    // second should start with the same base as first, plus a suffix
    expect(second.startsWith(first)).toBe(true)
    expect(second).toMatch(/_\d+$/)
  })

  it('third occurrence gets a different suffix than the second', () => {
    const factory = new BlockIdFactory()
    factory.next('paragraph', 'x')
    const second = factory.next('paragraph', 'x')
    const third = factory.next('paragraph', 'x')
    expect(third).not.toBe(second)
  })
})

describe('BlockIdFactory – text normalization', () => {
  it('text differing only by surrounding whitespace yields the same base id', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('paragraph', '  Hello world  ')).toBe(
      b.next('paragraph', 'Hello world'),
    )
  })

  it('text differing only by internal collapsed whitespace yields the same base id', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('paragraph', 'Hello   world')).toBe(
      b.next('paragraph', 'Hello world'),
    )
  })

  it('text differing only by case yields the same base id', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('paragraph', 'HELLO WORLD')).toBe(
      b.next('paragraph', 'hello world'),
    )
  })

  it('text differing by both whitespace and case yields the same base id', () => {
    const a = new BlockIdFactory()
    const b = new BlockIdFactory()
    expect(a.next('heading', '  My  HEADING  ')).toBe(
      b.next('heading', 'my heading'),
    )
  })
})
