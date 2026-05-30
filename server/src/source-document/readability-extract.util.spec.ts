import { extractReadableDocument } from './readability-extract.util'

// A realistic page: site chrome (nav/footer/aside) wrapping a real article.
// Readability should isolate the article and drop the chrome.
function page(articleInner: string): string {
  return `<!doctype html><html><head><title>Site Title — Page</title></head>
    <body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <header><h1>Site Banner</h1></header>
      <article>${articleInner}</article>
      <aside><p>Subscribe to our newsletter for more updates every week.</p></aside>
      <footer><p>© 2026 Example Corp. All rights reserved.</p></footer>
    </body></html>`
}

const ARTICLE = page(
  '<h1>Understanding Vectors</h1>' +
    '<p class="byline">By Ada Lovelace</p>' +
    '<p>A vector is an object that has both a magnitude and a direction. ' +
    'Vectors are fundamental to linear algebra and appear throughout physics ' +
    'and computer graphics whenever a quantity needs both size and heading.</p>' +
    '<h2>Addition</h2>' +
    '<p>Two vectors are added component by component, producing a new vector. ' +
    'This operation is commutative and associative, which makes vector spaces ' +
    'pleasant to reason about when composing many transformations together.</p>' +
    '<ul><li>Commutative</li><li>Associative</li></ul>' +
    '<p>The geometric picture is the parallelogram rule, where the sum is the ' +
    'diagonal of the parallelogram formed by the two vectors placed tail to tail.</p>',
)

describe('extractReadableDocument', () => {
  it('isolates the article and produces structured blocks', () => {
    const result = extractReadableDocument(
      ARTICLE,
      'https://example.com/vectors',
    )
    expect(result).not.toBeNull()
    const doc = result?.document
    expect(doc?.extractor).toBe('readability@1')
    expect(doc?.degraded).toBe(false)
    expect(doc?.blocks.length).toBeGreaterThan(0)

    // Article body survives; site chrome does not.
    const flat = result?.text ?? ''
    expect(flat).toContain('magnitude and a direction')
    expect(flat).not.toContain('Subscribe to our newsletter')
    expect(flat).not.toContain('All rights reserved')

    // Structure is preserved, not flattened to one run-on string.
    const types = doc?.blocks.map((b) => b.type) ?? []
    expect(types).toContain('heading')
    expect(types).toContain('paragraph')
  })

  it('carries a document title from Readability metadata', () => {
    const result = extractReadableDocument(
      ARTICLE,
      'https://example.com/vectors',
    )
    // Readability derives the title from <title>/og:title heuristics; we only
    // require that a non-empty title is captured (not a flattened blob).
    expect(typeof result?.document.title).toBe('string')
    expect(result?.document.title?.length).toBeGreaterThan(0)
    expect(result?.document.title).not.toContain('<')
  })

  it('returns null for empty input', () => {
    expect(extractReadableDocument('', 'https://example.com')).toBeNull()
    expect(extractReadableDocument('   ', 'https://example.com')).toBeNull()
  })

  it('returns null when there is no real article (too little content)', () => {
    const thin = '<html><body><div><p>Hi.</p></div></body></html>'
    expect(extractReadableDocument(thin, 'https://example.com')).toBeNull()
  })

  it('does not throw on a malformed base URL', () => {
    expect(() => extractReadableDocument(ARTICLE, 'not a url')).not.toThrow()
  })

  it('does not throw on malformed HTML', () => {
    expect(() =>
      extractReadableDocument(
        '<html><body><article><p>unclosed',
        'https://x.com',
      ),
    ).not.toThrow()
  })
})
