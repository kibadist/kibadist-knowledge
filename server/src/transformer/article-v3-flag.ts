/**
 * Article v3 opt-in feature flag (DET-344).
 *
 * v3 (the Source-Grounded Learning Article) ships as a PARALLEL pipeline that is
 * OPT-IN until its regression fixtures pass. Nothing routes to v3 unless this
 * flag is explicitly enabled — existing sources keep generating v2
 * (`source_preserving_article`) and existing records keep loading unchanged.
 *
 * The flag is a single env var so it can be flipped per-environment (off in prod,
 * on in a staging/dev box running the v3 regression suite) without a deploy of
 * new code. Kept as pure functions over a plain env map so it is trivially
 * unit-testable without booting Nest; the thin `isArticleV3Enabled` wrapper reads
 * `process.env` by default.
 */

import type { ArticleGenerationVersion } from './article-v3.types'

/** The env var that gates v3 generation. */
export const ARTICLE_V3_FLAG_ENV = 'ARTICLE_V3_ENABLED'

/**
 * Parse a raw env value as a boolean flag. Truthy values: `1`, `true`, `yes`,
 * `on` (case-insensitive, trimmed). Everything else — including unset — is false,
 * so the SAFE default (v2 only) holds unless the flag is deliberately turned on.
 */
export function parseV3Flag(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** True when v3 generation is enabled for this process. */
export function isArticleV3Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseV3Flag(env[ARTICLE_V3_FLAG_ENV])
}

/**
 * Resolve which article schema version a NEW generation job should target. This
 * is the single routing decision point: v3 only when the flag is on, v2
 * otherwise. The actual v3 generator is wired in a later ticket; this helper
 * exists now so the opt-in seam is in place and tested.
 */
export function resolveArticleGenerationVersion(
  env: Record<string, string | undefined> = process.env,
): ArticleGenerationVersion {
  return isArticleV3Enabled(env) ? 'v3' : 'v2'
}
