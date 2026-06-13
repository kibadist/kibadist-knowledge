import type { BlockerCode, QualityReport, V3ArticleStatus } from './v3.types'

/**
 * Targeted regeneration planning (DET-343, "Repair or publish"). Pure +
 * deterministic — NO LLM. Given a quality report whose status is BLOCKED, decide
 * whether the blockers are ADDRESSABLE by a focused regeneration pass (→
 * NEEDS_REGENERATION, with a concrete instruction set) or whether regeneration is
 * unlikely to help without source/pipeline changes (→ stays BLOCKED).
 *
 * The distinction matters because the pipeline only spends a second LLM pass when
 * it can plausibly move the needle: re-asking the model to ground missing important
 * blocks, drop/repair unsupported claims, or extract concepts it skipped are all
 * addressable; a source with genuinely no important substance is not.
 */

/** One concrete regeneration instruction the v3 generator can act on. */
export interface RegenerationTarget {
  /** Which blocker this addresses (1:1 with a hard blocker code). */
  blocker: BlockerCode
  /** What the regeneration pass should do. */
  instruction: string
  /** Section/block/claim ids to focus on (from the blocker's refs). */
  refs: string[]
}

/** The regeneration plan: the downgraded status + the targets to act on. */
export interface RegenerationPlan {
  status: V3ArticleStatus
  targets: RegenerationTarget[]
}

/** Hard blocker codes a targeted regeneration pass can plausibly fix. */
const ADDRESSABLE: ReadonlySet<BlockerCode> = new Set<BlockerCode>([
  'IMPORTANT_COVERAGE_BELOW_THRESHOLD',
  'UNSUPPORTED_CLAIMS_PRESENT',
  'NO_CONCEPT_CANDIDATES',
  'NO_RETRIEVAL_PROMPTS',
])

/** The instruction for a given addressable blocker. */
function instructionFor(code: BlockerCode): string {
  switch (code) {
    case 'IMPORTANT_COVERAGE_BELOW_THRESHOLD':
      return 'Rewrite to represent the missing important source blocks; cite each one.'
    case 'UNSUPPORTED_CLAIMS_PRESENT':
      return 'Remove or re-ground the unsupported claims so every claim cites a real source block.'
    case 'NO_CONCEPT_CANDIDATES':
      return 'Extract the key concepts the source defines or exemplifies, each grounded in its blocks.'
    case 'NO_RETRIEVAL_PROMPTS':
      return 'Generate retrieval prompts whose answers the source blocks support.'
    case 'LOW_EXERCISE_READINESS':
      return 'Strengthen the learning layer (more grounded concepts and retrieval prompts).'
  }
}

/**
 * Plan regeneration from a quality report. A report that already passed
 * (READY_FOR_REVIEW) returns no targets and keeps its status. A BLOCKED report
 * whose hard blockers are ALL addressable downgrades to NEEDS_REGENERATION with a
 * target per blocker; if ANY hard blocker is not addressable, the status stays
 * BLOCKED (a partial regen would leave a hard failure standing).
 */
export function planRegeneration(report: QualityReport): RegenerationPlan {
  const hardBlockers = report.blockers.filter((b) => b.severity === 'hard')
  if (hardBlockers.length === 0) {
    return { status: report.status, targets: [] }
  }

  const allAddressable = hardBlockers.every((b) => ADDRESSABLE.has(b.code))
  if (!allAddressable) {
    return { status: 'BLOCKED', targets: [] }
  }

  const targets: RegenerationTarget[] = hardBlockers.map((b) => ({
    blocker: b.code,
    instruction: instructionFor(b.code),
    refs: b.refs,
  }))
  return { status: 'NEEDS_REGENERATION', targets }
}
