import { extractUrlDocument } from './extract-url-document.util'

// The Wikipedia path enforces the shared SSRF guard before fetching; stub it so
// routing tests don't hit real DNS.
jest.mock('../inbox/url-fetch.util', () => ({
  assertPublicHost: jest.fn().mockResolvedValue(undefined),
}))

// Same body-stream Response helper as the wikipedia spec.
function jsonResponse(obj: unknown) {
  const body = JSON.stringify(obj)
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let sent = false
        return {
          read: async () =>
            sent
              ? { done: true, value: undefined }
              : ((sent = true),
                { done: false, value: new TextEncoder().encode(body) }),
          cancel: async () => {},
        }
      },
    },
  } as unknown as Response
}

function articlePage(): string {
  return `<!doctype html><html><head><title>Blog</title></head><body>
    <nav>menu</nav>
    <article>
      <h1>On Functions</h1>
      <p>A function maps each input to exactly one output. Functions are the
      backbone of programming and of mathematics alike, letting us name and
      reuse a computation wherever the same transformation is needed.</p>
      <p>Pure functions, which depend only on their inputs and cause no side
      effects, are especially easy to test and to reason about in isolation.</p>
    </article>
    <footer>© 2026</footer></body></html>`
}

afterEach(() => jest.restoreAllMocks())

describe('extractUrlDocument routing', () => {
  it('routes Wikipedia URLs to the MediaWiki extractor', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        parse: {
          title: 'Vector space',
          text:
            '<p>A vector space is a set whose elements, called vectors, may be ' +
            'added together and multiplied by scalars, subject to axioms that ' +
            'generalise the familiar arithmetic of geometric vectors. Vector ' +
            'spaces are the central objects of study in linear algebra, and ' +
            'they appear throughout mathematics, physics, and engineering ' +
            'wherever quantities combine linearly.</p>',
        },
      }),
    )
    const result = await extractUrlDocument(
      'https://en.wikipedia.org/wiki/Vector_space',
      '<html><body>ignored — wikipedia path uses the API</body></html>',
    )
    expect(result.document.extractor).toBe('mediawiki@1')
  })

  it('routes normal pages to Readability', async () => {
    // No network: Readability runs on the provided HTML.
    const fetchSpy = jest.spyOn(global, 'fetch')
    const result = await extractUrlDocument(
      'https://example.com/functions',
      articlePage(),
    )
    expect(result.document.extractor).toBe('readability@1')
    expect(result.text).toContain('maps each input')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to Readability on the fetched HTML when the Wikipedia API fails', async () => {
    // Wikipedia API is down, but we already fetched the page HTML — the router
    // must still produce a usable document from it rather than failing.
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('wiki api down'))
    const result = await extractUrlDocument(
      'https://en.wikipedia.org/wiki/Functions',
      articlePage(),
    )
    expect(result.document.extractor).toBe('readability@1')
    expect(result.text).toContain('maps each input')
  })

  it('falls back to the hand-rolled heuristic when Readability finds no article', async () => {
    const thin = '<html><body><div><p>too short</p></div></body></html>'
    const result = await extractUrlDocument('https://example.com/thin', thin)
    expect(result.document.extractor).toBe('html-heuristic@1')
  })

  it('always resolves to a document, never throws', async () => {
    const result = await extractUrlDocument('https://example.com/empty', '')
    expect(result.document.extractor).toBe('html-heuristic@1')
    expect(result.document.version).toBe(1)
  })
})
