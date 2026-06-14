import {
  ARTICLE_GENERATION_ENV,
  type ArticleGenerationFlags,
  LEGACY_MASTER_FLAG_ENV,
  parseFlag,
  readArticleGenerationFlags,
  routeArticleGeneration,
} from './article-generation-router'
import type { SourceKind } from './source-diagnosis.types'

/** A fully-off flag config; spread to flip individual flags per test. */
const OFF: ArticleGenerationFlags = {
  v3Enabled: false,
  transcriptsEnabled: false,
  structuredArticlesEnabled: false,
  internalPreviewOnly: true,
  fallbackToV2OnFailure: false,
}

describe('article generation router (DET-362)', () => {
  describe('parseFlag', () => {
    it('treats only explicit truthy strings as enabled', () => {
      for (const v of ['1', 'true', 'TRUE', ' yes ', 'On'])
        expect(parseFlag(v)).toBe(true)
      for (const v of ['0', 'false', 'no', 'off', 'maybe'])
        expect(parseFlag(v)).toBe(false)
    })

    it('returns the fallback for unset/empty values', () => {
      expect(parseFlag(undefined)).toBe(false)
      expect(parseFlag(undefined, true)).toBe(true)
      expect(parseFlag('', true)).toBe(true)
      expect(parseFlag('  ', true)).toBe(true)
    })
  })

  describe('readArticleGenerationFlags', () => {
    it('defaults to the conservative config (v2-only, preview-only on)', () => {
      const flags = readArticleGenerationFlags({})
      expect(flags).toEqual({
        v3Enabled: false,
        transcriptsEnabled: false,
        structuredArticlesEnabled: false,
        internalPreviewOnly: true,
        fallbackToV2OnFailure: false,
      })
    })

    it('reads each ARTICLE_GENERATION_V3_* flag', () => {
      const flags = readArticleGenerationFlags({
        [ARTICLE_GENERATION_ENV.v3Enabled]: 'true',
        [ARTICLE_GENERATION_ENV.transcriptsEnabled]: '1',
        [ARTICLE_GENERATION_ENV.structuredArticlesEnabled]: 'yes',
        [ARTICLE_GENERATION_ENV.internalPreviewOnly]: 'false',
        [ARTICLE_GENERATION_ENV.fallbackToV2OnFailure]: 'on',
      })
      expect(flags).toEqual({
        v3Enabled: true,
        transcriptsEnabled: true,
        structuredArticlesEnabled: true,
        internalPreviewOnly: false,
        fallbackToV2OnFailure: true,
      })
    })

    it('honours the legacy TRANSFORMER_V3_ENABLED alias for the master gate', () => {
      const flags = readArticleGenerationFlags({
        [LEGACY_MASTER_FLAG_ENV]: 'true',
      })
      expect(flags.v3Enabled).toBe(true)
    })
  })

  describe('routeArticleGeneration', () => {
    it('keeps EVERY source on v2 when the master flag is off (the default)', () => {
      const kinds: SourceKind[] = [
        'transcript_lesson',
        'structured_web_article',
        'documentation',
        'unknown',
      ]
      for (const kind of kinds) {
        const d = routeArticleGeneration(kind, OFF, { internalPreview: true })
        expect(d.pipeline).toBe('v2')
        expect(d.reason).toContain('master flag off')
      }
    })

    it('routes a transcript to v3 when transcripts are enabled (live, preview-only off)', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        transcriptsEnabled: true,
        internalPreviewOnly: false,
      }
      const d = routeArticleGeneration('transcript_lesson', flags)
      expect(d.pipeline).toBe('v3')
      expect(d.reason).toContain('transcript_lesson')
    })

    it('routes a structured web article to v3 when structured articles are enabled', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        structuredArticlesEnabled: true,
        internalPreviewOnly: false,
      }
      const d = routeArticleGeneration('structured_web_article', flags)
      expect(d.pipeline).toBe('v3')
    })

    it('isolates per-kind flags: a transcript flag does not route structured articles', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        transcriptsEnabled: true,
        internalPreviewOnly: false,
      }
      expect(routeArticleGeneration('transcript_lesson', flags).pipeline).toBe(
        'v3',
      )
      const structured = routeArticleGeneration('structured_web_article', flags)
      expect(structured.pipeline).toBe('v2')
      expect(structured.reason).toContain('not enabled for source kind')
    })

    it('global rollout: both per-kind flags on routes both supported kinds', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        transcriptsEnabled: true,
        structuredArticlesEnabled: true,
        internalPreviewOnly: false,
      }
      expect(routeArticleGeneration('transcript_lesson', flags).pipeline).toBe(
        'v3',
      )
      expect(
        routeArticleGeneration('structured_web_article', flags).pipeline,
      ).toBe('v3')
    })

    it('keeps unsupported kinds on v2 even with the master + preview-only off', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        transcriptsEnabled: true,
        structuredArticlesEnabled: true,
        internalPreviewOnly: false,
      }
      for (const kind of [
        'documentation',
        'research_paper',
        'unknown',
      ] as const) {
        const d = routeArticleGeneration(kind, flags)
        expect(d.pipeline).toBe('v2')
        expect(d.reason).toContain('not a v3-supported source kind')
      }
    })

    describe('internal-preview-only mode', () => {
      const flags: ArticleGenerationFlags = {
        ...OFF,
        v3Enabled: true,
        transcriptsEnabled: true,
        internalPreviewOnly: true,
      }

      it('routes a preview job to v3', () => {
        const d = routeArticleGeneration('transcript_lesson', flags, {
          internalPreview: true,
        })
        expect(d.pipeline).toBe('v3')
        expect(d.reason).toContain('internal preview')
      })

      it('keeps a live (non-preview) job on v2', () => {
        const d = routeArticleGeneration('transcript_lesson', flags)
        expect(d.pipeline).toBe('v2')
        expect(d.reason).toContain('internal-preview-only')
      })
    })

    describe('fallbackToV2OnFailure', () => {
      it('is carried through on every decision, defaulting off', () => {
        expect(
          routeArticleGeneration('transcript_lesson', OFF)
            .fallbackToV2OnFailure,
        ).toBe(false)
      })

      it('reflects the configured flag', () => {
        const flags: ArticleGenerationFlags = {
          ...OFF,
          v3Enabled: true,
          transcriptsEnabled: true,
          internalPreviewOnly: false,
          fallbackToV2OnFailure: true,
        }
        const d = routeArticleGeneration('transcript_lesson', flags)
        expect(d.pipeline).toBe('v3')
        expect(d.fallbackToV2OnFailure).toBe(true)
      })
    })
  })
})
