import { assessCompression } from './compression'

const SOURCE =
  'The mitochondrion is a double-membrane-bound organelle found in most ' +
  'eukaryotic cells. Mitochondria generate most of the cell supply of ' +
  'adenosine triphosphate, used as a source of chemical energy. They were ' +
  'first discovered in the nineteenth century and are often called the ' +
  'powerhouse of the cell because of their central role in energy production.'

describe('assessCompression', () => {
  it('flags an articulation copied verbatim from the source', () => {
    const copied =
      'Mitochondria generate most of the cell supply of adenosine ' +
      'triphosphate, used as a source of chemical energy.'
    const signal = assessCompression(copied, SOURCE)
    expect(signal.verbatim).toBe(true)
    expect(signal.message).toMatch(/own words/i)
    expect(signal.sourceOverlap).toBeGreaterThanOrEqual(0.7)
  })

  it('does not flag a genuine own-words paraphrase', () => {
    const paraphrase =
      'A mitochondrion is the part of a cell that turns food into usable ' +
      'energy, which is why people describe it as a tiny battery pack.'
    const signal = assessCompression(paraphrase, SOURCE)
    expect(signal.verbatim).toBe(false)
    expect(signal.message).toBeNull()
    expect(signal.sourceOverlap).toBeLessThan(0.7)
  })

  it('flags a short articulation that is an exact substring of the source', () => {
    const signal = assessCompression('powerhouse of the cell', SOURCE)
    expect(signal.verbatim).toBe(true)
    expect(signal.sourceOverlap).toBe(1)
  })

  it('does not flag when there is no source to copy from', () => {
    expect(assessCompression('Any text at all here.', null).verbatim).toBe(
      false,
    )
    expect(assessCompression('Any text at all here.', '').verbatim).toBe(false)
  })

  it('does not flag an empty articulation', () => {
    expect(assessCompression('', SOURCE).verbatim).toBe(false)
    expect(assessCompression(null, SOURCE).verbatim).toBe(false)
  })

  it('keeps sourceOverlap within [0, 1]', () => {
    for (const art of ['', 'short', SOURCE, 'a totally unrelated sentence']) {
      const { sourceOverlap } = assessCompression(art, SOURCE)
      expect(sourceOverlap).toBeGreaterThanOrEqual(0)
      expect(sourceOverlap).toBeLessThanOrEqual(1)
    }
  })

  it('ignores punctuation/casing differences when detecting a copy', () => {
    const copiedLoose =
      'MITOCHONDRIA generate most of the cell supply of adenosine ' +
      'triphosphate — used as a source of chemical energy!!!'
    expect(assessCompression(copiedLoose, SOURCE).verbatim).toBe(true)
  })
})
