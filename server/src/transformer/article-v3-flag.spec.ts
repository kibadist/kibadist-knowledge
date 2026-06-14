import {
  ARTICLE_V3_FLAG_ENV,
  isArticleV3Enabled,
  parseV3Flag,
  resolveArticleGenerationVersion,
} from './article-v3-flag'

describe('article v3 feature flag (DET-344)', () => {
  it('parseV3Flag treats only explicit truthy strings as enabled', () => {
    for (const v of ['1', 'true', 'TRUE', ' yes ', 'On'])
      expect(parseV3Flag(v)).toBe(true)
    for (const v of [undefined, '', '0', 'false', 'no', 'off', 'maybe'])
      expect(parseV3Flag(v)).toBe(false)
  })

  it('defaults to OFF (v2) when the env var is unset', () => {
    const env: Record<string, string | undefined> = {}
    expect(isArticleV3Enabled(env)).toBe(false)
    expect(resolveArticleGenerationVersion(env)).toBe('v2')
  })

  it('routes to v3 only when the flag is explicitly enabled', () => {
    const env = { [ARTICLE_V3_FLAG_ENV]: 'true' }
    expect(isArticleV3Enabled(env)).toBe(true)
    expect(resolveArticleGenerationVersion(env)).toBe('v3')
  })

  it('stays on v2 for a non-truthy flag value', () => {
    const env = { [ARTICLE_V3_FLAG_ENV]: 'eventually' }
    expect(resolveArticleGenerationVersion(env)).toBe('v2')
  })
})
