import { buildSourceNotes } from './source-notes.util'
import type { ClassifiedBlockInput } from './structure-model.service'

const block = (
  id: string,
  classification: string,
  text: string,
  removable = false,
): ClassifiedBlockInput => ({
  id,
  type: 'PARAGRAPH',
  classification,
  text,
  removable,
})

describe('buildSourceNotes', () => {
  it('sorts source apparatus into references / bibliography / links / nav / low-importance', () => {
    const notes = buildSourceNotes([
      block('b1', 'MAIN_ARGUMENT', 'The core claim of the article.'),
      block('b2', 'CITATION', '[1] Smith, J. (2019). On systems. doi:10.1/abc'),
      block('b3', 'CITATION', 'Further reading on the topic.'),
      block('b4', 'NAVIGATION_NOISE', 'Home · About · Contact', true),
      block('b5', 'FOOTER', '© 2026 Example Corp', true),
      block('b6', 'SIDEBAR', 'Related: https://example.com/more', true),
      block('b7', 'ADVERTISEMENT', 'Buy now!', true),
    ])

    // Formatted reference entry ([n] + (year) + doi) → references, with its URL? no URL → none.
    expect(notes.references).toHaveLength(1)
    expect(notes.references[0].sourceBlockIds).toEqual(['b2'])
    // A loose citation with no entry markers → bibliography.
    expect(notes.bibliography).toHaveLength(1)
    expect(notes.bibliography[0].sourceBlockIds).toEqual(['b3'])
    // Nav + footer → removedNavigation.
    expect(notes.removedNavigation.map((n) => n.sourceBlockIds[0])).toEqual([
      'b4',
      'b5',
    ])
    // A URL-bearing sidebar → externalLinks (with the extracted url).
    expect(notes.externalLinks).toHaveLength(1)
    expect(notes.externalLinks[0]).toMatchObject({
      sourceBlockIds: ['b6'],
      url: 'https://example.com/more',
    })
    // The ad (no URL) → lowImportance.
    expect(notes.lowImportance.map((n) => n.sourceBlockIds[0])).toEqual(['b7'])
  })

  it('leaves real body content out of the source notes', () => {
    const notes = buildSourceNotes([
      block('b1', 'MAIN_ARGUMENT', 'A kept body paragraph with no apparatus.'),
      block('b2', 'EVIDENCE', 'Supporting evidence, also body content.'),
    ])
    expect(notes.references).toHaveLength(0)
    expect(notes.bibliography).toHaveLength(0)
    expect(notes.externalLinks).toHaveLength(0)
    expect(notes.removedNavigation).toHaveLength(0)
    expect(notes.lowImportance).toHaveLength(0)
  })

  it('treats any removable noise block as low-importance even when unclassified', () => {
    const notes = buildSourceNotes([
      block('b1', 'UNCERTAIN', 'Cookie consent banner text.', true),
    ])
    expect(notes.lowImportance).toHaveLength(1)
    expect(notes.lowImportance[0].sourceBlockIds).toEqual(['b1'])
  })
})
