import type { QualityGateResultV3 } from './quality-gate.util'
import type { ArticleBlockerCode } from './v3-contract'

/**
 * Targeted regeneration planning (DET-343, "Repair or publish"). Pure +
 * deterministic — NO LLM. Given a quality-gate result whose status is held-back,
 * decide whether the hard blockers are ADDRESSABLE by a focused regeneration pass
 * (→ run a second targeted generation) or whether regeneration is unlikely to help
 * without source/pipeline changes (→ stay blocked).
 *
 * The distinction matters because the pipeline only spends a second LLM pass when
 * it can plausibly move the needle: re-asking the model to ground missing important
 * blocks, drop/repair unsupported claims, extract skipped concepts, or add missing
 * retrieval prompts are all addressable; a source with genuinely no important
 * substance is not.
 */

/** One concrete regeneration instruction the v3 generator can act on. */
export interface RegenerationTargetV3 {
  blocker: ArticleBlockerCode
  instruction: string
}

export interface RegenerationPlanV3 {
  /** True when a targeted second pass is worth running. */
  shouldRegenerate: boolean
  targets: RegenerationTargetV3[]
}

/** Hard blocker codes a targeted regeneration pass can plausibly fix. */
const ADDRESSABLE: ReadonlySet<ArticleBlockerCode> =
  new Set<ArticleBlockerCode>([
    'low_coverage',
    'unsupported_claims',
    'missing_concepts',
    'weak_exercise_readiness',
    'lost_information',
  ])

function instructionFor(code: ArticleBlockerCode): string {
  switch (code) {
    case 'low_coverage':
      return 'Represent the missing important source blocks; cite each one.'
    case 'unsupported_claims':
      return 'Drop or re-ground unsupported claims so every claim cites a real block.'
    case 'missing_concepts':
      return 'Extract the key concepts the source defines or exemplifies.'
    case 'weak_exercise_readiness':
      return 'Add source-grounded retrieval prompts.'
    case 'lost_information':
      return 'Recover the dropped important source material.'
    case 'fidelity':
      return 'Re-ground the high-risk fragments to their source blocks.'
  }
}

/**
 * Plan regeneration from a gate result. A passed article (no hard blockers) is not
 * regenerated. A held-back article whose hard blockers are ALL addressable yields a
 * target per blocker; if ANY hard blocker is not addressable, no regeneration runs
 * (a partial regen would leave a hard failure standing).
 */
export function planRegenerationV3(
  result: QualityGateResultV3,
): RegenerationPlanV3 {
  const codes = [...new Set(result.hardBlockerCodes)]
  if (codes.length === 0) {
    return { shouldRegenerate: false, targets: [] }
  }
  if (!codes.every((c) => ADDRESSABLE.has(c))) {
    return { shouldRegenerate: false, targets: [] }
  }
  return {
    shouldRegenerate: true,
    targets: codes.map((c) => ({ blocker: c, instruction: instructionFor(c) })),
  }
}
