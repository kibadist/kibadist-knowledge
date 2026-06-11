import type { IllustrationType } from './schemas'

/**
 * Illustration taxonomy — the SINGLE source of truth for how each illustration
 * type is realised, and whether it may render automatically. Both the budget
 * (illustration-budget.util) and the render dispatch (article-pipeline) consult
 * this so the policy can never drift between "what to auto-render" and "how".
 *
 * Two render strategies:
 *  - 'image'   → a generative gpt-image-1 plate (editorial/metaphorical work the
 *                model is good at and where exact accuracy is not load-bearing).
 *  - 'diagram' → a PROGRAMMATIC figure rendered from a `diagramSpec` (nodes +
 *                edges) as SVG on the client. Higher trust: no invented visual
 *                facts, no baked-in text, deterministic. Preferred for anything
 *                structural — process/flow, comparison, data — where precision
 *                matters more than mood.
 *
 * Auto-eligibility is a SEPARATE axis: a type may be valid yet still kept out of
 * the automatic pass (decorative work and data figures should be a deliberate,
 * user-driven choice, never spent on by default).
 */
export type RenderStrategy = 'image' | 'diagram'

/** Types realised as generative gpt-image-1 plates. */
const IMAGE_TYPES = new Set<IllustrationType>([
  'editorial_cover',
  'decorative_section',
  'concept_metaphor',
  'mechanism_explanation',
])

/** Types realised as programmatic SVG diagrams from a `diagramSpec`. */
const DIAGRAM_TYPES = new Set<IllustrationType>([
  'source_based_diagram',
  'process_diagram',
  'comparison_visual',
  'data_figure',
])

/**
 * Types the automatic pass never spends on — they are valid suggestions that
 * should only ever be rendered on explicit user approval: decoration carries no
 * comprehension value, and a data figure must be built from real structured data
 * the author vouches for, never auto-improvised.
 */
const MANUAL_ONLY_TYPES = new Set<IllustrationType>([
  'decorative_section',
  'data_figure',
])

/** How a given illustration type is realised. */
export function renderStrategyFor(type: IllustrationType): RenderStrategy {
  return DIAGRAM_TYPES.has(type) ? 'diagram' : 'image'
}

export function isDiagramType(type: IllustrationType): boolean {
  return DIAGRAM_TYPES.has(type)
}

export function isImageType(type: IllustrationType): boolean {
  return IMAGE_TYPES.has(type)
}

/** Whether the automatic render pass may consider this type at all. */
export function autoEligibleByType(type: IllustrationType): boolean {
  return !MANUAL_ONLY_TYPES.has(type)
}
