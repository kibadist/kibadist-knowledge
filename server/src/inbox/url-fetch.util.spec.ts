import { fetchFailureMessage } from './url-fetch.util'

describe('fetchFailureMessage', () => {
  const CHALLENGE = /bot or login challenge/

  it('flags a Cloudflare challenge via the cf-mitigated header (even on 403)', () => {
    expect(fetchFailureMessage(403, 'challenge')).toMatch(CHALLENGE)
  })

  it('flags any cf-mitigated value regardless of status', () => {
    expect(fetchFailureMessage(503, 'managed')).toMatch(CHALLENGE)
  })

  it.each([401, 403, 429])('flags status %s as a challenge', (status) => {
    expect(fetchFailureMessage(status, null)).toMatch(CHALLENGE)
  })

  it('steers the user to the paste path', () => {
    expect(fetchFailureMessage(403, null).toLowerCase()).toContain('paste')
  })

  it.each([
    404, 410, 500, 502,
  ])('keeps the plain status message for ordinary failure %s', (status) => {
    expect(fetchFailureMessage(status, null)).toBe(
      `URL responded with ${status}`,
    )
  })
})
