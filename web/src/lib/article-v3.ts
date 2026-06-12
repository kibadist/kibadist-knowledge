/**
 * Article JSON v3 — client mirror of the server contract (DET-343).
 *
 * Mirrors `server/src/transformer/v3/v3.types.ts` (the frozen source of truth) so
 * the web can render the Source-Grounded Learning Article. Keep the two in sync
 * when either changes — same rule as `article-v2.ts` ↔ the server v2 contract.
 *
 * A v3 article is LEARNING-FIRST and SOURCE-GROUNDED: the learning layer
 * (learning path, key concepts, key claims, retrieval prompts, source notes) lives
 * INSIDE the document, and every block + claim carries a `provenance` so the
 * renderer can make AI scaffolding visibly distinct from source-grounded content.
 */

export const ARTICLE_SCHEMA_VERSION_V3 = 'v3' as const

export type SourceKind =
  | 'transcript'
  | 'structured_article'
  | 'reference'
  | 'mixed'

export type ArticleShapeV3 =
  | 'lesson'
  | 'concept_explainer'
  | 'procedure'
  | 'overview'
  | 'reference_entry'

/** `source` = faithful rewrite of named blocks; `scaffold` = AI connective tissue. */
export type Provenance = 'source' | 'scaffold'

export interface ArticleBlockV3 {
  id: string
  type: 'paragraph' | 'list' | 'callout' | 'example' | 'definition'
  text: string
  sourceBlockIds: string[]
  provenance: Provenance
  fidelityRisk: 'low' | 'medium' | 'high'
  items?: string[]
}

export interface ArticleSectionV3 {
  id: string
  heading: string
  headingProvenance: Provenance
  sourceBlockIds: string[]
  blocks: ArticleBlockV3[]
}

export interface LearningPathStep {
  id: string
  objective: string
  sectionIds: string[]
}

export interface KeyConcept {
  id: string
  label: string
  definition: string
  sourceBlockIds: string[]
  aiAssisted: true
}

export interface KeyClaim {
  id: string
  text: string
  sourceBlockIds: string[]
  support: 'grounded' | 'unsupported'
}

export interface RetrievalPromptV3 {
  id: string
  prompt: string
  sourceBlockIds: string[]
}

export interface SourceNote {
  id: string
  text: string
  sourceBlockIds: string[]
}

export interface LearningLayerV3 {
  learningPath: LearningPathStep[]
  keyConcepts: KeyConcept[]
  keyClaims: KeyClaim[]
  retrievalPrompts: RetrievalPromptV3[]
  sourceNotes: SourceNote[]
}

export interface ProvenanceSummary {
  totalBlocks: number
  sourceGroundedBlocks: number
  scaffoldBlocks: number
  groundedPercent: number
}

export interface ArticleJsonV3 {
  schemaVersion: typeof ARTICLE_SCHEMA_VERSION_V3
  sourceKind: SourceKind
  shape: ArticleShapeV3
  title: { text: string; provenance: Provenance }
  summary: { text: string; provenance: Provenance }
  sections: ArticleSectionV3[]
  learning: LearningLayerV3
  provenance: ProvenanceSummary
}

// --- Quality report ----------------------------------------------------------

export type V3ArticleStatus =
  | 'READY_FOR_REVIEW'
  | 'BLOCKED'
  | 'NEEDS_REGENERATION'
  | 'FAILED'

export type BlockerCode =
  | 'IMPORTANT_COVERAGE_BELOW_THRESHOLD'
  | 'UNSUPPORTED_CLAIMS_PRESENT'
  | 'NO_CONCEPT_CANDIDATES'
  | 'NO_RETRIEVAL_PROMPTS'
  | 'LOW_EXERCISE_READINESS'

export interface QualityBlocker {
  code: BlockerCode
  severity: 'hard' | 'soft'
  message: string
  refs: string[]
}

export interface QualityReport {
  status: V3ArticleStatus
  sourceKind: SourceKind
  importantCoveragePercent: number
  importantCoverageThreshold: number
  unsupportedClaimCount: number
  conceptCandidateCount: number
  retrievalPromptCount: number
  exerciseReadiness: number
  groundedPercent: number
  blockers: QualityBlocker[]
}

// --- Helpers -----------------------------------------------------------------

/** Whether a block/claim/title is AI scaffolding (vs source-grounded). */
export function isScaffold(provenance: Provenance): boolean {
  return provenance === 'scaffold'
}

/** A human label for an article's source kind (UI chips). */
export function sourceKindLabel(kind: SourceKind): string {
  switch (kind) {
    case 'transcript':
      return 'Transcript lesson'
    case 'structured_article':
      return 'Structured article'
    case 'reference':
      return 'Reference'
    case 'mixed':
      return 'Mixed source'
  }
}

/** A human label for the v3 learning-quality status. */
export function v3StatusLabel(status: V3ArticleStatus): string {
  switch (status) {
    case 'READY_FOR_REVIEW':
      return 'Ready for review'
    case 'BLOCKED':
      return 'Blocked'
    case 'NEEDS_REGENERATION':
      return 'Needs regeneration'
    case 'FAILED':
      return 'Failed'
  }
}

/** All section ids a learning objective is taught by (for cross-linking). */
export function objectiveSectionIds(step: LearningPathStep): string[] {
  return [...new Set(step.sectionIds)]
}
