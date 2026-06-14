import type {
  ArticleBlock,
  ArticleBlockerReason,
  ArticleJsonV2,
  ArticleSectionV2,
  RegenerationStage,
} from './transformer.types'

/**
 * Pure helpers for targeted regeneration (DET-356). The strategy registry maps a
 * blocker reason → which pipeline stage(s) to re-run and why; the transforms
 * (claim pruning, section preservation) are deterministic and NO LLM, so they are
 * unit-testable and form the deterministic core of the repair the orchestrating
 * `ArticleRegenerationService` drives.
 */

/** The repair strategy for one blocker reason: which stages, and why. */
export interface RegenerationStrategy {
  stages: RegenerationStage[]
  why: string
}

/**
 * The strategy registry (DET-356) — EVERY blocker reason maps to a strategy, so a
 * repair pass always knows which stage to re-run and can record why. `claim_pruning`
 * is a deterministic in-place transform (no stage rerun); the others re-run real
 * pipeline stages. `fidelity_recheck` is appended by the orchestrator after any
 * repair so the gate is always re-evaluated.
 */
const STRATEGY: Record<ArticleBlockerReason, RegenerationStrategy> = {
  low_coverage: {
    stages: ['reshaping_plan', 'generation'],
    why: 'Re-plan and regenerate so high-importance unrepresented source blocks are merged into sections; prior valid sections are preserved.',
  },
  unsupported_claims: {
    stages: ['claim_pruning'],
    why: 'Remove article content the source does not support (no source backing found), keeping every grounded section intact.',
  },
  missing_concepts: {
    stages: ['learning_extraction'],
    why: 'Re-run learning extraction against the source blocks and article sections to mint the missing concept candidates.',
  },
  poor_transcript_coherence: {
    stages: ['conceptual_segmentation', 'reshaping_plan', 'generation'],
    why: 'Re-segment the transcript by teaching intent and rebuild the outline so the lesson arc is preserved before rewriting.',
  },
}

/** Look up the targeted repair strategy for a blocker reason. */
export function strategyFor(
  reason: ArticleBlockerReason,
): RegenerationStrategy {
  return STRATEGY[reason]
}

/**
 * Remove unsupported claims from an article in place (DET-356), deterministically:
 *
 *  - drop any section block whose id is in `refsToRemove` (the unsupported-claims
 *    blocker's `articleRefs` — the fidelity findings' article items);
 *  - drop any section block with NO sourceBlockIds (untraceable ⇒ unsupported);
 *  - drop end-matter (keyTerms / sourceExamples / caveats) whose sourceBlockIds is
 *    empty (untraceable);
 *  - drop generated callouts / comparison tables whose sourceBlockIds is empty.
 *
 * A section that loses all its blocks is dropped entirely. Returns the pruned
 * article plus the ids/refs removed (for the action record). The product does not
 * yet support an explicit "AI Context" mode, so unsupported content is removed
 * rather than relocated (per the ticket: "Move to explicit AI Context only if the
 * product later allows that mode").
 */
export function removeUnsupportedClaims(
  article: ArticleJsonV2,
  refsToRemove: string[],
): { article: ArticleJsonV2; removedRefs: string[] } {
  const remove = new Set(refsToRemove)
  const removedRefs: string[] = []

  const keepBlock = (b: ArticleBlock): boolean => {
    if (remove.has(b.id) || b.sourceBlockIds.length === 0) {
      removedRefs.push(b.id)
      return false
    }
    return true
  }

  const pruneSection = (s: ArticleSectionV2): ArticleSectionV2 | null => {
    const blocks = s.blocks.filter(keepBlock)
    const subsections = (s.subsections ?? [])
      .map(pruneSection)
      .filter((x): x is ArticleSectionV2 => x !== null)
    // A section with no surviving blocks AND no surviving subsections is dropped.
    if (blocks.length === 0 && subsections.length === 0) {
      removedRefs.push(s.id)
      return null
    }
    return subsections.length > 0
      ? { ...s, blocks, subsections }
      : { ...s, blocks }
  }

  const sections = article.sections
    .map(pruneSection)
    .filter((x): x is ArticleSectionV2 => x !== null)

  const hasBacking = (item: { sourceBlockIds: string[] }) =>
    item.sourceBlockIds.length > 0

  const pruned: ArticleJsonV2 = {
    ...article,
    sections,
    keyTerms: article.keyTerms.filter(hasBacking),
    sourceExamples: article.sourceExamples.filter(hasBacking),
    caveats: article.caveats.filter(hasBacking),
  }

  // Prune ungrounded source-grounded extras (DET-350 callouts/tables) too.
  if (article.calloutPlacements?.generated) {
    pruned.calloutPlacements = {
      ...article.calloutPlacements,
      generated: article.calloutPlacements.generated.filter(
        (c) => c.sourceBlockIds.length > 0,
      ),
    }
  }
  if (article.tables) {
    pruned.tables = article.tables.filter((t) => t.sourceBlockIds.length > 0)
  }

  return { article: pruned, removedRefs }
}

/**
 * Merge a regenerated article's sections over the prior ones (DET-356), preserving
 * prior valid sections where possible:
 *
 *  - a prior section whose id is in `invalidSectionIds` is REPLACED by the
 *    regenerated section with the same id (if one exists), else dropped;
 *  - every other prior section is KEPT verbatim (preserved);
 *  - regenerated sections whose ids are NOT in the prior article are APPENDED
 *    (they cover material the prior generation missed — e.g. low-coverage gaps).
 *
 * Returns the merged section list and the ids preserved verbatim, so the repair
 * report can record exactly what survived.
 */
export function preserveValidSections(
  prior: ArticleSectionV2[],
  regenerated: ArticleSectionV2[],
  invalidSectionIds: string[],
): { sections: ArticleSectionV2[]; preservedSectionIds: string[] } {
  const invalid = new Set(invalidSectionIds)
  const regenById = new Map(regenerated.map((s) => [s.id, s]))
  const priorIds = new Set(prior.map((s) => s.id))

  const sections: ArticleSectionV2[] = []
  const preservedSectionIds: string[] = []

  for (const section of prior) {
    if (invalid.has(section.id)) {
      const replacement = regenById.get(section.id)
      if (replacement) sections.push(replacement)
      // No replacement ⇒ the invalid section is dropped.
      continue
    }
    sections.push(section)
    preservedSectionIds.push(section.id)
  }

  // Append regenerated sections that did not exist before (gap-filling sections).
  for (const section of regenerated) {
    if (!priorIds.has(section.id)) sections.push(section)
  }

  return { sections, preservedSectionIds }
}
