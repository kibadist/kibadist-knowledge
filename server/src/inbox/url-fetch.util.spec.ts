import { lookup } from 'node:dns/promises'

import { BadRequestException } from '@nestjs/common'

import { fetchFailureMessage, resolvePublicHost } from './url-fetch.util'

// node:dns/promises lookup is a non-configurable binding (can't spyOn it), so
// mock the module. resolvePublicHost short-circuits IP literals before lookup.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
const mockLookup = lookup as jest.Mock

describe('resolvePublicHost — validate + pin (DET-206)', () => {
  afterEach(() => mockLookup.mockReset())

  it('returns the address for a public IP literal without a DNS lookup', async () => {
    await expect(resolvePublicHost('8.8.8.8')).resolves.toEqual([
      { address: '8.8.8.8', family: 4 },
    ])
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('rejects a private/loopback IP literal', async () => {
    await expect(resolvePublicHost('127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(resolvePublicHost('10.0.0.5')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(resolvePublicHost('[::1]')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('resolves a hostname and returns every validated address (to pin against)', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
    await expect(resolvePublicHost('example.com')).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
  })

  it('rejects the host if ANY resolved address is private (rebinding defense)', async () => {
    // A name that resolves to a public AND a private IP must be refused — the
    // private one is the rebinding target we must never connect to.
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 }, // cloud metadata link-local
    ])
    await expect(resolvePublicHost('rebind.example')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('throws when the host cannot be resolved', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(resolvePublicHost('nope.invalid')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})

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
