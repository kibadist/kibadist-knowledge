import type {
  IllustrationPlan,
  IllustrationSuggestion,
  SourcePreservingArticle,
} from '@/lib/api'

/**
 * Anchors illustration suggestions to the article (DET-259/261 + the magazine
 * redesign). The backend only renders images for EXISTING approved suggestions
 * (each carries sourceBlockIds), so inline slots are DRIVEN BY the suggestions:
 *
 *  - the `editorial_cover` suggestion → the HERO slot (top of the article),
 *  - every other suggestion → the section whose source block ids overlap it
 *    most (best/max-overlap unused suggestion per section),
 *  - a section's block ids = union of its paragraphs' sourceBlockIds plus the
 *    section's own sourceBlockIds,
 *  - each suggestion renders inline in EXACTLY ONE place; leftovers fall back
 *    to the management grid in the "Behind the article" drawer.
 */
export interface IllustrationPlacement {
  /** The cover suggestion for the hero slot, if any. */
  hero: IllustrationSuggestion | null
  /** sectionId → the single suggestion anchored to that section. */
  bySection: Map<string, IllustrationSuggestion>
  /** Suggestions matched to no section/hero — shown in the drawer grid. */
  unplaced: IllustrationSuggestion[]
}

function sectionBlockIds(
  section: SourcePreservingArticle['sections'][number],
): Set<string> {
  const ids = new Set<string>(section.sourceBlockIds)
  for (const p of section.paragraphs)
    for (const id of p.sourceBlockIds) ids.add(id)
  return ids
}

function overlap(ids: Set<string>, suggestion: IllustrationSuggestion): number {
  let n = 0
  for (const id of suggestion.sourceBlockIds) if (ids.has(id)) n++
  return n
}

export function placeIllustrations(
  article: SourcePreservingArticle,
  plan: IllustrationPlan | null,
): IllustrationPlacement {
  const empty: IllustrationPlacement = {
    hero: null,
    bySection: new Map(),
    unplaced: [],
  }
  if (!plan || plan.suggestions.length === 0) return empty

  // The cover claims the hero slot first; remaining suggestions compete for
  // sections. A rejected suggestion is not placed inline — it falls to the
  // drawer where it can be re-approved/managed.
  let hero: IllustrationSuggestion | null = null
  const pool: IllustrationSuggestion[] = []
  for (const s of plan.suggestions) {
    if (
      s.approval !== 'rejected' &&
      s.illustrationType === 'editorial_cover' &&
      !hero
    ) {
      hero = s
    } else {
      pool.push(s)
    }
  }

  const bySection = new Map<string, IllustrationSuggestion>()
  const used = new Set<string>()

  // Greedy max-overlap, section by section in document order: each section
  // takes the unused, non-rejected suggestion with the highest source-block
  // overlap (ties broken by document order of the suggestion).
  for (const section of article.sections) {
    const ids = sectionBlockIds(section)
    let best: IllustrationSuggestion | null = null
    let bestScore = 0
    for (const s of pool) {
      if (used.has(s.id) || s.approval === 'rejected') continue
      const score = overlap(ids, s)
      if (score > bestScore) {
        best = s
        bestScore = score
      }
    }
    if (best && bestScore > 0) {
      bySection.set(section.id, best)
      used.add(best.id)
    }
  }

  // Everything not placed inline (incl. rejected suggestions + unmatched cover
  // candidates) goes to the drawer's management grid.
  const unplaced = plan.suggestions.filter(
    (s) => s.id !== hero?.id && !used.has(s.id),
  )

  return { hero, bySection, unplaced }
}
