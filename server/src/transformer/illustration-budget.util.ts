import { autoEligibleByType, renderStrategyFor } from './illustration-taxonomy'
import type { IllustrationSuggestion, IllustrationType } from './schemas'
import type { FidelityRisk } from './transformer.types'

/**
 * The automatic-render budget (replaces the old "first N eligible" cap). Auto
 * images cost gpt-image-1 latency and money, so they are a SCARCE budget spent on
 * the highest-value suggestions — not whichever happened to come first. A score
 * ranks each candidate by how much it earns its place; the top `maxImages`
 * generative plates are rendered, the rest stay pending for manual approval.
 *
 * Programmatic diagrams are NOT part of the image budget: they cost nothing to
 * produce (the client draws the SVG), so every eligible diagram that already
 * carries a spec is auto-placed.
 *
 * The whole module is pure and deterministic so the selection is unit-testable
 * without the pipeline.
 */

/** Comprehension value of each type — what it tends to do for understanding. */
const TYPE_IMPORTANCE: Record<IllustrationType, number> = {
  // Plates.
  editorial_cover: 1,
  decorative_section: 0,
  concept_metaphor: 2,
  mechanism_explanation: 3,
  // Diagrams (scored too, though they don't compete for the image budget).
  source_based_diagram: 3,
  process_diagram: 3,
  comparison_visual: 2,
  data_figure: 2,
}

const FIDELITY_PENALTY: Record<FidelityRisk, number> = {
  low: 0,
  medium: -2,
  high: -5,
}

/** Per-extra-occurrence penalty so a third cover scores below a first diagram. */
const REDUNDANCY_PENALTY = 1

/**
 * Score one suggestion in isolation: comprehension value + how well it is
 * grounded (capped so a single over-cited suggestion can't dominate) minus its
 * fidelity-risk penalty. Redundancy is applied later, across the set.
 */
export function scoreSuggestion(s: {
  illustrationType: IllustrationType
  fidelityRisk: FidelityRisk
  sourceBlockIds: string[]
}): number {
  const importance = TYPE_IMPORTANCE[s.illustrationType] ?? 0
  const grounding = Math.min(s.sourceBlockIds.length, 3)
  return importance + grounding + FIDELITY_PENALTY[s.fidelityRisk]
}

export interface AutoRenderPlan {
  /** Suggestion ids to render as generative images, best first, ≤ maxImages. */
  imageRenderIds: string[]
  /** Diagram suggestions (with a spec) to auto-place — no image cost. */
  diagramAutoIds: string[]
}

/**
 * Decide what the automatic pass renders. Excludes types the policy reserves for
 * manual approval and any high-fidelity-risk suggestion (those always wait for an
 * explicit decision). Generative plates are ranked by score (with a redundancy
 * penalty for repeating a type) and the top `maxImages` are taken; eligible
 * diagrams that already carry a spec are all auto-placed.
 */
export function planAutoRender(
  suggestions: IllustrationSuggestion[],
  opts: { maxImages: number },
): AutoRenderPlan {
  const eligible = suggestions.filter(
    (s) => autoEligibleByType(s.illustrationType) && s.fidelityRisk !== 'high',
  )

  const diagramAutoIds = eligible
    .filter(
      (s) =>
        renderStrategyFor(s.illustrationType) === 'diagram' && s.diagramSpec,
    )
    .map((s) => s.id)

  const imageCandidates = eligible.filter(
    (s) => renderStrategyFor(s.illustrationType) === 'image',
  )

  // Rank by raw score; on ties keep input order stable (the planner's own order).
  const ranked = imageCandidates
    .map((s, i) => ({ s, base: scoreSuggestion(s), i }))
    .sort((a, b) => (b.base !== a.base ? b.base - a.base : a.i - b.i))

  const imageRenderIds: string[] = []
  const typeCounts = new Map<IllustrationType, number>()
  for (const { s } of ranked) {
    if (imageRenderIds.length >= opts.maxImages) break
    // A repeated type is worth less than a fresh one; once the redundancy
    // penalty drags it below zero it no longer earns an auto slot.
    const seen = typeCounts.get(s.illustrationType) ?? 0
    const effective = scoreSuggestion(s) - seen * REDUNDANCY_PENALTY
    if (effective <= 0) continue
    imageRenderIds.push(s.id)
    typeCounts.set(s.illustrationType, seen + 1)
  }

  return { imageRenderIds, diagramAutoIds }
}
