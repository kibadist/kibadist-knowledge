/**
 * Pure helpers for the DET-351 whole-article concept extraction. None of these
 * touch the network or the LLM — they are the deterministic CODE guards that turn
 * an untrusted model proposal into grounded, deduplicated candidates:
 *  - `normalizeConceptName` is the single normalization used for both dedup and
 *    relationship-target resolution (so "Query/Key/Value" and "query key value"
 *    collapse to one concept);
 *  - `buildBlockToSectionIndex` maps each source-block id to the article sections
 *    that cite it, so a candidate's `articleSectionIds` are resolved from its real
 *    grounding rather than trusted from the model;
 *  - `dedupeArticleConceptCandidates` merges candidates that share a normalized
 *    name (union of provenance + relationships, strongest importance wins).
 */

import type {
  ArticleConceptCandidate,
  ConceptRelationshipType,
} from './schemas'
import type { ArticleJsonV2, ArticleSectionV2 } from './transformer.types'

/**
 * Canonical concept-name form used for dedup and relationship resolution.
 * Lowercases, strips diacritics, replaces any non-alphanumeric run with a single
 * space, and trims. Deterministic and idempotent.
 */
export function normalizeConceptName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Map every source-block id to the set of article section ids that cite it. A
 * section cites a block when the block id appears in the section's own
 * `sourceBlockIds`, its heading provenance, or any of its content blocks'
 * `sourceBlockIds`. Subsections map to their OWN id (one block can therefore
 * belong to several sections). Used to resolve a candidate's `articleSectionIds`
 * from its grounded blocks.
 */
export function buildBlockToSectionIndex(
  article: ArticleJsonV2,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (blockId: string, sectionId: string) => {
    let set = index.get(blockId)
    if (!set) {
      set = new Set<string>()
      index.set(blockId, set)
    }
    set.add(sectionId)
  }
  const walk = (sections: ArticleSectionV2[]) => {
    for (const s of sections) {
      for (const id of s.sourceBlockIds) add(id, s.id)
      for (const id of s.headingSourceBlockIds ?? []) add(id, s.id)
      for (const b of s.blocks) for (const id of b.sourceBlockIds) add(id, s.id)
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)
  return index
}

/** The article section ids that cite ANY of the given source blocks (stable order). */
export function sectionIdsForBlocks(
  index: Map<string, Set<string>>,
  blockIds: string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const blockId of blockIds) {
    const sections = index.get(blockId)
    if (!sections) continue
    for (const sectionId of sections) {
      if (seen.has(sectionId)) continue
      seen.add(sectionId)
      out.push(sectionId)
    }
  }
  return out
}

const IMPORTANCE_RANK: Record<ArticleConceptCandidate['importance'], number> = {
  low: 0,
  medium: 1,
  high: 2,
}

const COGNITIVE_RANK: Record<
  ArticleConceptCandidate['suggestedCognitiveState'],
  number
> = {
  Seen: 0,
  Parsed: 1,
}

/** The set of valid relationship kinds, for mapping untrusted model strings. */
const RELATIONSHIP_TYPES: ReadonlySet<string> =
  new Set<ConceptRelationshipType>([
    'related_to',
    'prerequisite_of',
    'confused_with',
    'contrasts_with',
    'example_of',
    'applied_in',
    'misconception_about',
  ])

/** Coerce an untrusted relationship-type string to the enum, or null if unknown. */
export function toRelationshipType(
  value: string,
): ConceptRelationshipType | null {
  const v = value.trim().toLowerCase()
  return RELATIONSHIP_TYPES.has(v) ? (v as ConceptRelationshipType) : null
}

/**
 * Merge candidates that share a `normalizedName`. The first occurrence sets the
 * display `name`/`type`/`domain`/`shortDefinition` (later non-empty values fill
 * gaps only); `sourceBlockIds`, `articleSectionIds` and `relationshipCandidates`
 * are unioned; `importance` and `suggestedCognitiveState` take the strongest
 * value seen; `eligibleForLibraryReview` is recomputed from the merged importance.
 * Order of first appearance is preserved.
 */
export function dedupeArticleConceptCandidates(
  candidates: ArticleConceptCandidate[],
): ArticleConceptCandidate[] {
  const byName = new Map<string, ArticleConceptCandidate>()
  for (const c of candidates) {
    const existing = byName.get(c.normalizedName)
    if (!existing) {
      byName.set(c.normalizedName, { ...c })
      continue
    }
    existing.sourceBlockIds = unionStrings(
      existing.sourceBlockIds,
      c.sourceBlockIds,
    )
    existing.articleSectionIds = unionStrings(
      existing.articleSectionIds,
      c.articleSectionIds,
    )
    if (IMPORTANCE_RANK[c.importance] > IMPORTANCE_RANK[existing.importance]) {
      existing.importance = c.importance
    }
    if (
      COGNITIVE_RANK[c.suggestedCognitiveState] >
      COGNITIVE_RANK[existing.suggestedCognitiveState]
    ) {
      existing.suggestedCognitiveState = c.suggestedCognitiveState
    }
    existing.domain ??= c.domain
    existing.shortDefinition ??= c.shortDefinition
    existing.relationshipCandidates = mergeRelationships(
      existing.relationshipCandidates,
      c.relationshipCandidates,
    )
  }
  // Recompute the code-owned eligibility from the merged importance.
  return [...byName.values()].map((c) => ({
    ...c,
    eligibleForLibraryReview: c.importance === 'high',
    relationshipCandidates:
      c.relationshipCandidates && c.relationshipCandidates.length > 0
        ? c.relationshipCandidates
        : undefined,
  }))
}

function unionStrings(a: string[], b: string[]): string[] {
  const out = [...a]
  const seen = new Set(a)
  for (const x of b) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

function mergeRelationships(
  a: ArticleConceptCandidate['relationshipCandidates'],
  b: ArticleConceptCandidate['relationshipCandidates'],
): ArticleConceptCandidate['relationshipCandidates'] {
  const out = [...(a ?? [])]
  const key = (r: { type: string; targetNormalizedName: string }) =>
    `${r.type}::${r.targetNormalizedName}`
  const seen = new Set(out.map(key))
  for (const r of b ?? []) {
    if (seen.has(key(r))) continue
    seen.add(key(r))
    out.push(r)
  }
  return out
}
