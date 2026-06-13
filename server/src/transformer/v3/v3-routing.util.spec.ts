import {
  DEFAULT_V3_CONFIG,
  resolveV3Config,
  shouldUseV3,
  type V3Config,
} from './v3-routing.util'

describe('resolveV3Config (DET-343)', () => {
  it('defaults to off for missing/unknown mode (fail safe to v2)', () => {
    expect(resolveV3Config({}).mode).toBe('off')
    expect(resolveV3Config({ mode: 'nonsense' }).mode).toBe('off')
  })

  it('parses each rollout mode', () => {
    expect(resolveV3Config({ mode: 'preview' }).mode).toBe('preview')
    expect(resolveV3Config({ mode: 'SOURCE_KIND' }).mode).toBe('source_kind')
    expect(resolveV3Config({ mode: 'on' }).mode).toBe('on')
  })

  it('parses enabled kinds, ignoring invalid entries', () => {
    const config = resolveV3Config({
      mode: 'source_kind',
      kinds: 'transcript, bogus ,reference',
    })
    expect([...config.enabledKinds].sort()).toEqual(['reference', 'transcript'])
  })
})

describe('shouldUseV3 (DET-343)', () => {
  const cfg = (partial: Partial<V3Config>): V3Config => ({
    mode: 'off',
    enabledKinds: new Set(),
    ...partial,
  })

  it('off → never routes to v3', () => {
    expect(
      shouldUseV3(DEFAULT_V3_CONFIG, {
        sourceKind: 'transcript',
        previewOptIn: true,
      }),
    ).toBe(false)
  })

  it('on → always routes to v3', () => {
    expect(
      shouldUseV3(cfg({ mode: 'on' }), {
        sourceKind: null,
        previewOptIn: false,
      }),
    ).toBe(true)
  })

  it('preview → only opted-in sources route to v3', () => {
    const config = cfg({ mode: 'preview' })
    expect(
      shouldUseV3(config, { sourceKind: 'transcript', previewOptIn: true }),
    ).toBe(true)
    expect(
      shouldUseV3(config, { sourceKind: 'transcript', previewOptIn: false }),
    ).toBe(false)
  })

  it('source_kind → routes enabled kinds, plus preview opt-in always wins', () => {
    const config = cfg({
      mode: 'source_kind',
      enabledKinds: new Set(['transcript']),
    })
    expect(
      shouldUseV3(config, { sourceKind: 'transcript', previewOptIn: false }),
    ).toBe(true)
    expect(
      shouldUseV3(config, {
        sourceKind: 'structured_article',
        previewOptIn: false,
      }),
    ).toBe(false)
    // An un-enabled kind still reaches v3 if it opted into preview.
    expect(
      shouldUseV3(config, {
        sourceKind: 'structured_article',
        previewOptIn: true,
      }),
    ).toBe(true)
    // Unknown kind never matches the kind gate.
    expect(shouldUseV3(config, { sourceKind: null, previewOptIn: false })).toBe(
      false,
    )
  })
})
