import type { SourceKind } from './v3.types'

/**
 * v3 feature-flag + source-kind routing (DET-343). Pure + deterministic — NO I/O.
 * Decides whether a given source runs through the v3 engine or the frozen v2
 * fallback. The strangler migration is staged through this single function:
 *
 *  1. OFF        — v3 disabled entirely; everything runs v2 (the ship-safe default).
 *  2. PREVIEW    — only sources explicitly tagged for v3 (test/preview material)
 *                  route to v3; all real ingestion stays v2 until fixtures pass.
 *  3. SOURCE_KIND — v3 runs for the source kinds whose regression fixtures have met
 *                  the quality gates (e.g. transcripts first), v2 for the rest.
 *  4. ON         — v3 is the default for everything; v2 remains only as a fallback.
 *
 * Config comes from env (`TRANSFORMER_V3_MODE`, `TRANSFORMER_V3_KINDS`); parsing
 * lives in `resolveV3Config` so the decision itself stays a pure function the tests
 * pin exactly.
 */

export type V3RolloutMode = 'off' | 'preview' | 'source_kind' | 'on'

export interface V3Config {
  mode: V3RolloutMode
  /** Kinds enabled when mode === 'source_kind'. */
  enabledKinds: ReadonlySet<SourceKind>
}

/** A request to route — what we know about the source at routing time. */
export interface RoutingInput {
  /** Detected source kind (from `diagnoseSource`); null if not yet diagnosed. */
  sourceKind: SourceKind | null
  /** True when the source was explicitly tagged as v3 test/preview material. */
  previewOptIn: boolean
}

/** The ship-safe default: v3 off, no kinds enabled. */
export const DEFAULT_V3_CONFIG: V3Config = {
  mode: 'off',
  enabledKinds: new Set(),
}

const ALL_KINDS: readonly SourceKind[] = [
  'transcript',
  'structured_article',
  'reference',
  'mixed',
]

/**
 * Parse the v3 rollout config from environment values. Unknown/empty mode ⇒ 'off'
 * (fail safe to v2). `kinds` is a comma list of source kinds; invalid entries are
 * ignored. Kept separate from `shouldUseV3` so the routing decision is pure.
 */
export function resolveV3Config(env: {
  mode?: string | null
  kinds?: string | null
}): V3Config {
  const mode = parseMode(env.mode)
  const enabledKinds = new Set<SourceKind>(
    (env.kinds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SourceKind =>
        (ALL_KINDS as readonly string[]).includes(s),
      ),
  )
  return { mode, enabledKinds }
}

function parseMode(raw?: string | null): V3RolloutMode {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'preview':
      return 'preview'
    case 'source_kind':
      return 'source_kind'
    case 'on':
      return 'on'
    default:
      return 'off'
  }
}

/**
 * The routing decision: should THIS source run through v3? Pure and total.
 *  - 'off'         → never.
 *  - 'preview'     → only when the source opted in (test/preview material).
 *  - 'source_kind' → when the (known) kind is in `enabledKinds`; an unknown kind
 *                    never matches (we can't route what we haven't diagnosed).
 *  - 'on'          → always.
 * Preview opt-in is an OR across every mode below 'on' — explicitly tagged test
 * sources always reach v3 so fixtures can be exercised regardless of the kind gate.
 */
export function shouldUseV3(config: V3Config, input: RoutingInput): boolean {
  if (config.mode === 'on') return true
  if (config.mode === 'off') return false
  if (input.previewOptIn) return true
  if (config.mode === 'source_kind' && input.sourceKind) {
    return config.enabledKinds.has(input.sourceKind)
  }
  return false
}
