/**
 * Article generation router (DET-362).
 *
 * The single decision point that chooses the v2 (legacy, source-preserving) or v3
 * (source-grounded learning) pipeline for a generation job. v3 ships as a PARALLEL
 * pipeline beside a frozen v2 fallback (DET-344 architecture note): v2 is rewritten
 * NOWHERE — the router only decides which path a NEW job takes, and v2 stays the
 * default until the flags below are explicitly turned on.
 *
 * The decision is a pure function of five inputs (per the ticket):
 *   1. the master feature flag,
 *   2. the detected source kind,
 *   3. the per-source-kind rollout flags,
 *   4. internal-preview mode, and
 *   5. (for failure handling) the explicit v2-fallback flag.
 *
 * It is kept as pure functions over a plain env map so it is trivially unit-testable
 * without booting Nest; `SourceDiagnosisService` reads `process.env` (via Nest's
 * ConfigService) and delegates the decision here.
 *
 * THREE ROLLOUT MODES (acceptance criteria) fall out of the flag combinations:
 *   - internal preview only  → master on, INTERNAL_PREVIEW_ONLY on: only preview
 *     jobs route to v3; every live job stays on v2.
 *   - per source kind        → master on, INTERNAL_PREVIEW_ONLY off, exactly one of
 *     the per-kind flags on: only that kind's live jobs route to v3.
 *   - globally               → master on, INTERNAL_PREVIEW_ONLY off, both per-kind
 *     flags on: every v3-supported kind routes to v3.
 *
 * v3 currently supports only the two initially-targeted, known-broken kinds
 * (`transcript_lesson`, `structured_web_article`); every other kind — and
 * `unknown` — always falls back to v2, even with the master flag on, because there
 * is no v3 generator for them yet.
 */

import type { SourceKind } from './source-diagnosis.types'

/** Which generation pipeline a job runs. */
export type ArticleGenerationPipeline = 'v2' | 'v3'

/** Env var names the router reads. The canonical `ARTICLE_GENERATION_V3_*` set. */
export const ARTICLE_GENERATION_ENV = {
  /** Master gate. While off, EVERY source generates v2 (the default). */
  v3Enabled: 'ARTICLE_GENERATION_V3_ENABLED',
  /** Allow v3 for detected `transcript_lesson` sources. */
  transcriptsEnabled: 'ARTICLE_GENERATION_V3_TRANSCRIPTS_ENABLED',
  /** Allow v3 for detected `structured_web_article` sources. */
  structuredArticlesEnabled:
    'ARTICLE_GENERATION_V3_STRUCTURED_ARTICLES_ENABLED',
  /** When on, v3 runs ONLY for internal-preview jobs; live jobs stay on v2. */
  internalPreviewOnly: 'ARTICLE_GENERATION_V3_INTERNAL_PREVIEW_ONLY',
  /** When on, a FAILED v3 job is allowed to re-run on v2 (opt-in). */
  fallbackToV2OnFailure: 'ARTICLE_GENERATION_V3_FALLBACK_TO_V2',
} as const

/**
 * Legacy single-flag alias (DET-345) for the master gate. Recognised so an
 * existing `TRANSFORMER_V3_ENABLED=true` deploy keeps opting into v3 routing after
 * this migration; the canonical `ARTICLE_GENERATION_V3_ENABLED` takes precedence.
 */
export const LEGACY_MASTER_FLAG_ENV = 'TRANSFORMER_V3_ENABLED'

/** The resolved router configuration. */
export interface ArticleGenerationFlags {
  /** Master gate. False ⇒ v2 for everything. */
  v3Enabled: boolean
  /** v3 allowed for `transcript_lesson` sources. */
  transcriptsEnabled: boolean
  /** v3 allowed for `structured_web_article` sources. */
  structuredArticlesEnabled: boolean
  /** v3 restricted to internal-preview jobs only. */
  internalPreviewOnly: boolean
  /** A failed v3 job may fall back to v2 (otherwise it stays FAILED). */
  fallbackToV2OnFailure: boolean
}

/** The router's decision for one generation job. */
export interface ArticleGenerationRouting {
  pipeline: ArticleGenerationPipeline
  /** One-line, human-readable explanation of the choice (logged per job). */
  reason: string
  /** Whether a failed v3 job may be re-run on v2 (carried for the pipeline). */
  fallbackToV2OnFailure: boolean
}

/** Optional per-job context the router considers beyond the flags + kind. */
export interface ArticleGenerationContext {
  /** True when the job is an internal preview (not a learner-facing generation). */
  internalPreview?: boolean
}

/**
 * Parse a raw env value as a boolean flag. Truthy: `1`, `true`, `yes`, `on`
 * (case-insensitive, trimmed). Everything else — including unset — yields the
 * provided default (false unless stated), so the SAFE default holds unless a flag
 * is deliberately set.
 */
export function parseFlag(
  value: string | undefined,
  fallback = false,
): boolean {
  if (value === undefined) return fallback
  const v = value.trim().toLowerCase()
  if (v === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(v)
}

/**
 * Resolve the router configuration from an env map. Every flag defaults to the
 * conservative value:
 *  - master / per-kind / fallback default OFF (v2 stays the default path),
 *  - `internalPreviewOnly` defaults ON, so even with the master + a kind flag set,
 *    nothing routes to v3 for a LIVE job until preview-only is explicitly cleared.
 */
export function readArticleGenerationFlags(
  env: Record<string, string | undefined> = process.env,
): ArticleGenerationFlags {
  const master =
    parseFlag(env[ARTICLE_GENERATION_ENV.v3Enabled]) ||
    // Legacy alias: only consulted when the canonical flag is unset/false.
    parseFlag(env[LEGACY_MASTER_FLAG_ENV])
  return {
    v3Enabled: master,
    transcriptsEnabled: parseFlag(
      env[ARTICLE_GENERATION_ENV.transcriptsEnabled],
    ),
    structuredArticlesEnabled: parseFlag(
      env[ARTICLE_GENERATION_ENV.structuredArticlesEnabled],
    ),
    internalPreviewOnly: parseFlag(
      env[ARTICLE_GENERATION_ENV.internalPreviewOnly],
      true,
    ),
    fallbackToV2OnFailure: parseFlag(
      env[ARTICLE_GENERATION_ENV.fallbackToV2OnFailure],
    ),
  }
}

/** The per-kind flag that gates each v3-supported source kind. */
function perKindFlag(
  kind: SourceKind,
  flags: ArticleGenerationFlags,
): { supported: boolean; enabled: boolean } {
  switch (kind) {
    case 'transcript_lesson':
      return { supported: true, enabled: flags.transcriptsEnabled }
    case 'structured_web_article':
      return { supported: true, enabled: flags.structuredArticlesEnabled }
    default:
      // No v3 generator for this kind yet (research_paper, raw_notes,
      // documentation, unknown) — always the v2 fallback.
      return { supported: false, enabled: false }
  }
}

/**
 * Decide which pipeline a generation job runs. Pure; mirrors the ticket's router
 * pseudocode exactly, with the internal-preview gate layered in:
 *
 *   if (!v3Enabled)                              -> v2  (default, flag off)
 *   if (internalPreviewOnly && !internalPreview) -> v2  (preview-only mode)
 *   if (kind supported && that kind's flag on)   -> v3
 *   otherwise                                    -> v2  (unsupported kind / kind flag off)
 *
 * The returned `fallbackToV2OnFailure` is the configured failure policy, carried so
 * the pipeline knows whether a failed v3 run may retry on v2.
 */
export function routeArticleGeneration(
  sourceKind: SourceKind,
  flags: ArticleGenerationFlags,
  context: ArticleGenerationContext = {},
): ArticleGenerationRouting {
  const fallbackToV2OnFailure = flags.fallbackToV2OnFailure
  const v2 = (reason: string): ArticleGenerationRouting => ({
    pipeline: 'v2',
    reason,
    fallbackToV2OnFailure,
  })

  if (!flags.v3Enabled) {
    return v2(`v2 fallback: v3 master flag off (kind=${sourceKind})`)
  }

  const internalPreview = context.internalPreview === true
  if (flags.internalPreviewOnly && !internalPreview) {
    return v2(
      `v2 fallback: v3 in internal-preview-only mode and this is a live job (kind=${sourceKind})`,
    )
  }

  const { supported, enabled } = perKindFlag(sourceKind, flags)
  if (!supported) {
    return v2(`v2 fallback: ${sourceKind} is not a v3-supported source kind`)
  }
  if (!enabled) {
    return v2(`v2 fallback: v3 not enabled for source kind ${sourceKind}`)
  }

  const previewNote = internalPreview ? ' (internal preview)' : ''
  return {
    pipeline: 'v3',
    reason: `v3 routing: enabled for ${sourceKind}${previewNote}`,
    fallbackToV2OnFailure,
  }
}
