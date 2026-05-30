import { assertPublicHost } from '../inbox/url-fetch.util'
import {
  extractWikipediaDocument,
  isWikipediaUrl,
} from './wikipedia-extract.util'

// The MediaWiki fetch enforces the shared SSRF guard before connecting; stub it
// so tests don't hit real DNS. Individual tests can override the resolved value.
jest.mock('../inbox/url-fetch.util', () => ({
  assertPublicHost: jest.fn(),
}))
const mockAssertPublicHost = assertPublicHost as jest.Mock

// Build a fetch Response whose body streams the given string, capped-read safe.
function jsonResponse(obj: unknown, init?: { ok?: boolean; status?: number }) {
  const body = JSON.stringify(obj)
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
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

const PARSE_HTML =
  '<h2>History</h2>' +
  '<p>Linear algebra is the branch of mathematics concerning linear equations ' +
  'and linear maps, and their representations in vector spaces and through ' +
  'matrices. It is central to almost all areas of mathematics.</p>' +
  '<ul><li>Vectors</li><li>Matrices</li></ul>'

beforeEach(() => {
  mockAssertPublicHost.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('isWikipediaUrl', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/Linear_algebra', true],
    ['https://de.wikipedia.org/wiki/Vektor', true],
    ['https://wikipedia.org/wiki/Foo', true],
    ['http://en.wikipedia.org/wiki/Foo', true],
    ['https://en.wikipedia.org.evil.com/wiki/Foo', false],
    ['https://notwikipedia.org/wiki/Foo', false],
    ['https://example.com/wiki/Foo', false],
    ['ftp://en.wikipedia.org/wiki/Foo', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isWikipediaUrl(url)).toBe(expected)
  })
})

describe('extractWikipediaDocument', () => {
  it('extracts structured blocks from the MediaWiki parse API', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ parse: { title: 'Linear algebra', text: PARSE_HTML } }),
      )

    const result = await extractWikipediaDocument(
      'https://en.wikipedia.org/wiki/Linear_algebra',
    )

    expect(result).not.toBeNull()
    expect(result?.document.extractor).toBe('mediawiki@1')
    expect(result?.document.title).toBe('Linear algebra')
    expect(result?.text).toContain('branch of mathematics')
    expect(result?.document.blocks.some((b) => b.type === 'heading')).toBe(true)

    // Calls the parse API on the same wikipedia host, with the page title.
    const called = new URL(fetchSpy.mock.calls[0][0] as string | URL)
    expect(called.hostname).toBe('en.wikipedia.org')
    expect(called.pathname).toBe('/w/api.php')
    expect(called.searchParams.get('action')).toBe('parse')
    expect(called.searchParams.get('page')).toBe('Linear algebra')
    expect(called.protocol).toBe('https:')
  })

  it('decodes a percent-encoded title from the path', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ parse: { title: 'Café', text: PARSE_HTML } }),
      )
    await extractWikipediaDocument('https://en.wikipedia.org/wiki/Caf%C3%A9')
    const called = new URL(fetchSpy.mock.calls[0][0] as string | URL)
    expect(called.searchParams.get('page')).toBe('Café')
  })

  it('returns null for non-Wikipedia URLs without fetching', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    expect(
      await extractWikipediaDocument('https://example.com/wiki/Foo'),
    ).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when there is no article title', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/'),
    ).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null on a MediaWiki API error response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ error: { code: 'missingtitle' } }))
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Nope'),
    ).toBeNull()
  })

  it('returns null on a non-OK HTTP response (incl. redirects)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 301 }))
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Foo'),
    ).toBeNull()
  })

  it('returns null when fetch throws (network/timeout)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'))
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Foo'),
    ).toBeNull()
  })

  it('fails closed (no fetch) when the SSRF guard rejects the host', async () => {
    mockAssertPublicHost.mockRejectedValueOnce(new Error('host not allowed'))
    const fetchSpy = jest.spyOn(global, 'fetch')
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Foo'),
    ).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when the parsed article is below the text floor', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ parse: { title: 'Stub', text: '<p>Too short.</p>' } }),
      )
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Stub'),
    ).toBeNull()
  })

  it('returns null on unparseable JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
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
                  {
                    done: false,
                    value: new TextEncoder().encode('<<not json>>'),
                  }),
            cancel: async () => {},
          }
        },
      },
    } as unknown as Response)
    expect(
      await extractWikipediaDocument('https://en.wikipedia.org/wiki/Foo'),
    ).toBeNull()
  })
})
