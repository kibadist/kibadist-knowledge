import type { ConfigService } from '@nestjs/config'

import {
  documentationBlocks,
  structuredWebArticleBlocks,
  transcriptLessonBlocks,
} from './__fixtures__/source-kinds'
import { SourceDiagnosisService } from './source-diagnosis.service'

/** Build a service whose ConfigService returns a fixed TRANSFORMER_V3_ENABLED. */
function makeService(flag?: string): SourceDiagnosisService {
  const config = {
    get: (key: string) => (key === 'TRANSFORMER_V3_ENABLED' ? flag : undefined),
  } as unknown as ConfigService
  return new SourceDiagnosisService(config)
}

describe('SourceDiagnosisService.isV3Enabled', () => {
  it('is off by default (flag unset)', () => {
    expect(makeService(undefined).isV3Enabled()).toBe(false)
  })

  it.each([
    '1',
    'true',
    'TRUE',
    'yes',
    'on',
    ' On ',
  ])('is on for truthy value %p', (v) => {
    expect(makeService(v).isV3Enabled()).toBe(true)
  })

  it.each(['0', 'false', 'no', 'off', ''])('is off for falsy value %p', (v) => {
    expect(makeService(v).isV3Enabled()).toBe(false)
  })
})

describe('SourceDiagnosisService.route — rollout gating', () => {
  it('routes a transcript to v3 ONLY when the flag is on', () => {
    const off = makeService(undefined).route(transcriptLessonBlocks)
    expect(off.diagnosis.sourceKind).toBe('transcript_lesson')
    expect(off.pipeline).toBe('v2')

    const on = makeService('true').route(transcriptLessonBlocks)
    expect(on.diagnosis.sourceKind).toBe('transcript_lesson')
    expect(on.pipeline).toBe('v3')
  })

  it('routes a structured web article to v3 when the flag is on', () => {
    const on = makeService('1').route(structuredWebArticleBlocks)
    expect(on.diagnosis.sourceKind).toBe('structured_web_article')
    expect(on.pipeline).toBe('v3')
  })

  it('keeps a non-target kind on v2 even when the flag is on', () => {
    // documentation is detected but is NOT one of the two initially-targeted
    // v3 kinds, so it stays on the v2 fallback.
    const on = makeService('true').route(documentationBlocks)
    expect(on.diagnosis.sourceKind).toBe('documentation')
    expect(on.pipeline).toBe('v2')
  })

  it('keeps unknown sources on v2 with no shape (conservative fallback)', () => {
    const on = makeService('true').route([
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

  it('always carries a human-readable reason and the diagnosis', () => {
    const d = makeService('true').route(transcriptLessonBlocks)
    expect(d.reason).toContain('v3 routing')
    expect(d.diagnosis.signals.totalBlocks).toBe(transcriptLessonBlocks.length)
  })
})
