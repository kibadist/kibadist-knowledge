import type { ConfigService } from '@nestjs/config'
import {
  documentationBlocks,
  structuredWebArticleBlocks,
  transcriptLessonBlocks,
} from './__fixtures__/source-kinds'
import { ARTICLE_GENERATION_ENV } from './article-generation-router'
import { SourceDiagnosisService } from './source-diagnosis.service'

/** Build a service whose ConfigService returns the given env map. */
function makeService(
  env: Record<string, string | undefined> = {},
): SourceDiagnosisService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService
  return new SourceDiagnosisService(config)
}

/** The flag combo that opts a LIVE job into v3 for both supported kinds. */
const GLOBAL_V3 = {
  [ARTICLE_GENERATION_ENV.v3Enabled]: 'true',
  [ARTICLE_GENERATION_ENV.transcriptsEnabled]: 'true',
  [ARTICLE_GENERATION_ENV.structuredArticlesEnabled]: 'true',
  [ARTICLE_GENERATION_ENV.internalPreviewOnly]: 'false',
}

describe('SourceDiagnosisService.isV3Enabled', () => {
  it('is off by default (flags unset)', () => {
    expect(makeService().isV3Enabled()).toBe(false)
  })

  it.each([
    '1',
    'true',
    'TRUE',
    'yes',
    'on',
    ' On ',
  ])('is on for truthy master value %p', (v) => {
    expect(
      makeService({ [ARTICLE_GENERATION_ENV.v3Enabled]: v }).isV3Enabled(),
    ).toBe(true)
  })

  it.each([
    '0',
    'false',
    'no',
    'off',
    '',
  ])('is off for falsy master value %p', (v) => {
    expect(
      makeService({ [ARTICLE_GENERATION_ENV.v3Enabled]: v }).isV3Enabled(),
    ).toBe(false)
  })

  it('honours the legacy TRANSFORMER_V3_ENABLED alias', () => {
    expect(makeService({ TRANSFORMER_V3_ENABLED: 'true' }).isV3Enabled()).toBe(
      true,
    )
  })
})

describe('SourceDiagnosisService.route — DET-362 rollout gating', () => {
  it('keeps every source on v2 when the master flag is off (the default)', () => {
    const off = makeService().route(transcriptLessonBlocks)
    expect(off.diagnosis.sourceKind).toBe('transcript_lesson')
    expect(off.pipeline).toBe('v2')
    expect(off.reason).toContain('master flag off')
  })

  it('routes a transcript to v3 when transcripts are enabled (live)', () => {
    const on = makeService(GLOBAL_V3).route(transcriptLessonBlocks)
    expect(on.diagnosis.sourceKind).toBe('transcript_lesson')
    expect(on.pipeline).toBe('v3')
  })

  it('routes a structured web article to v3 when structured articles are enabled', () => {
    const on = makeService(GLOBAL_V3).route(structuredWebArticleBlocks)
    expect(on.diagnosis.sourceKind).toBe('structured_web_article')
    expect(on.pipeline).toBe('v3')
  })

  it('honours per-kind flags independently', () => {
    // Only transcripts enabled: a structured article stays on v2.
    const transcriptsOnly = makeService({
      [ARTICLE_GENERATION_ENV.v3Enabled]: 'true',
      [ARTICLE_GENERATION_ENV.transcriptsEnabled]: 'true',
      [ARTICLE_GENERATION_ENV.internalPreviewOnly]: 'false',
    })
    expect(transcriptsOnly.route(transcriptLessonBlocks).pipeline).toBe('v3')
    expect(transcriptsOnly.route(structuredWebArticleBlocks).pipeline).toBe(
      'v2',
    )
  })

  it('routes to v3 for an internal preview job in preview-only mode', () => {
    // Master + transcripts on, preview-only left at its default (true).
    const previewMode = makeService({
      [ARTICLE_GENERATION_ENV.v3Enabled]: 'true',
      [ARTICLE_GENERATION_ENV.transcriptsEnabled]: 'true',
    })
    expect(
      previewMode.route(transcriptLessonBlocks, {}, { internalPreview: true })
        .pipeline,
    ).toBe('v3')
    // A live job in the same mode stays on v2.
    expect(previewMode.route(transcriptLessonBlocks).pipeline).toBe('v2')
  })

  it('keeps a non-target kind on v2 even when the flags are on', () => {
    const on = makeService(GLOBAL_V3).route(documentationBlocks)
    expect(on.diagnosis.sourceKind).toBe('documentation')
    expect(on.pipeline).toBe('v2')
  })

  it('keeps unknown sources on v2 with no shape (conservative fallback)', () => {
    const on = makeService(GLOBAL_V3).route([
      {
        id: 'x',
        type: 'UNKNOWN',
        classification: 'UNCERTAIN',
        text: 'Lorem ipsum.',
        removable: false,
      },
    ])
    expect(on.diagnosis.sourceKind).toBe('unknown')
    expect(on.diagnosis.articleShape).toBeNull()
    expect(on.pipeline).toBe('v2')
  })

  it('carries the explicit v2-fallback-on-failure policy from the flag', () => {
    const noFallback = makeService(GLOBAL_V3).route(transcriptLessonBlocks)
    expect(noFallback.pipeline).toBe('v3')
    expect(noFallback.fallbackToV2OnFailure).toBe(false)

    const withFallback = makeService({
      ...GLOBAL_V3,
      [ARTICLE_GENERATION_ENV.fallbackToV2OnFailure]: 'true',
    }).route(transcriptLessonBlocks)
    expect(withFallback.fallbackToV2OnFailure).toBe(true)
  })

  it('always carries a human-readable reason and the diagnosis', () => {
    const d = makeService(GLOBAL_V3).route(transcriptLessonBlocks)
    expect(d.reason).toContain('v3 routing')
    expect(d.diagnosis.signals.totalBlocks).toBe(transcriptLessonBlocks.length)
  })
})
