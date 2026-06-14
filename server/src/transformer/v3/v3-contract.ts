/**
 * Article JSON v3 — the SERVER-side contract for source-grounded learning
 * articles (the "Source-Grounded Learning Article Engine" epic DET-343).
 *
 * THIS FILE IS A VERBATIM MIRROR of the client contract in
 * `web/src/lib/article-v3.ts`. The web reader (`ArticleV3View`, DET-357) renders
 * exactly this shape, so the v3 generation pipeline MUST emit it byte-compatibly:
 * the persisted `articleJson` is handed to the client untouched at the read
 * boundary (`transformer.service.ts`) and the client casts it to its own
 * `ArticleJsonV3`. Keep the two files in lock-step — a divergence here renders as
 * a blank/`undefined` field in the reader.
 *
 * WHY a fresh contract (and not the older `article-v3.types.ts`). DET-344 drafted
 * a server v3 contract built around a `SourceTrace` primitive; DET-357 then shipped
 * the *reader* against a flatter, learning-first shape (`paragraphs` not typed
 * blocks; flat `sourceBlockIds` + `aiAssisted`; a top-level `status`; a
 * blocker/regeneration-aware `qualityReport`). The reader is the side that must be
 * satisfied, and its `qualityReport`/`status` map 1:1 onto the epic's acceptance
 * criteria (important coverage %, unsupported-claim count, concept candidates,
 * retrieval prompts, blocker reasons, regeneration hints). So the reader's contract
 * is canonical and this file mirrors it; `article-v3.types.ts` is left as a legacy
 * draft (only its lightweight `isArticleV3` guard is still used).
 *
 * STRANGLER PATTERN (DET-343). v3 is a PARALLEL pipeline beside the frozen v2
 * (`ArticleJsonV2`), gated by a feature flag + source-kind routing (default off).
 * v3 reuses the existing `articleJson` column and is discriminated on
 * `schemaVersion: 'v3'` + `mode: 'source_grounded_learning_article'` — v2 keeps
 * `'v2'` / `'source_preserving_article'` and renders through the Compendium
 * unchanged. No new column, no migration.
 *
 * SOURCE-TRACE INVARIANT. Every paragraph, section, claim, concept, callout,
 * table, and prompt carries source-block ids so the reader can ground each rendered
 * fragment back in the original material. AI scaffolding (a fragment with no source
 * blocks, or `aiAssisted: true`) is rendered visually distinct from source-grounded
 * claims — never silently mixed in. Grounding/provenance is decided in CODE
 * (assembly), never trusted from the model.
 */

export const ARTICLE_JSON_V3 = 'v3' as const
export const ARTICLE_V3_MODE = 'source_grounded_learning_article' as const

// --- Source diagnosis (DET-345) ---------------------------------------------

/** What kind of source the article was generated from (detected pre-generation). */
export type SourceKind =
  | 'transcript_lesson'
  | 'structured_web_article'
  | 'research_paper'
  | 'raw_notes'
  | 'documentation'
  | 'unknown'

/** The learning shape the article was reorganised into (selected from sourceKind). */
export type ArticleShapeV3 =
  | 'lesson_article'
  | 'concept_explainer'
  | 'research_digest'
  | 'technical_walkthrough'
  | 'reference_digest'
  | 'structured_notes'

// --- Quality gates + blocker status (DET-355) -------------------------------

export type ArticleStatusV3 =
  | 'DRAFT'
  | 'GENERATING'
  | 'NEEDS_REGENERATION'
  | 'BLOCKED_LOW_COVERAGE'
  | 'BLOCKED_UNSUPPORTED_CLAIMS'
  | 'BLOCKED_MISSING_CONCEPTS'
  | 'BLOCKED_FIDELITY'
  | 'READY_FOR_REVIEW'
  | 'FINAL'

export type ArticleBlockerCode =
  | 'low_coverage'
  | 'unsupported_claims'
  | 'missing_concepts'
  | 'fidelity'
  | 'lost_information'
  | 'weak_exercise_readiness'

export interface ArticleBlockerReason {
  code: ArticleBlockerCode
  message: string
  qualityReportRef?: string
  sourceBlockIds?: string[]
}

// --- Fidelity + transformation provenance -----------------------------------

export type FidelityRiskV3 = 'low' | 'medium' | 'high'

export type TransformationTypeV3 =
  | 'verbatim'
  | 'grammar_cleanup'
  | 'speech_cleanup'
  | 'light_reword'
  | 'source_grounded_rewrite'
  | 'source_grounded_summary'
  | 'paragraph_split'
  | 'paragraph_merge'
  | 'heading_inference'

export interface ArticleProvenanceV3 {
  sourceId?: string
  sourceUrl?: string | null
  sourceKind: SourceKind
  captureMethod?: 'PASTE' | 'URL' | 'PDF'
  capturedAt?: string
  totalSourceBlocks?: number
  representedSourceBlocks?: number
  sourceAvailable?: boolean
}

// --- Body content ------------------------------------------------------------

export interface ArticleTitleV3 {
  text: string
  source?: 'original' | 'cleanedOriginal' | 'inferred'
}

export interface ArticleParagraphV3 {
  id: string
  text: string
  sourceBlockIds: string[]
  transformationType?: TransformationTypeV3
  fidelityRisk?: FidelityRiskV3
  aiAssisted?: boolean
}

export type SectionRoleV3 =
  | 'introduction'
  | 'definition'
  | 'boundaries'
  | 'mechanism'
  | 'types'
  | 'example'
  | 'application'
  | 'misconception'
  | 'evidence'
  | 'method'
  | 'results'
  | 'limitations'
  | 'implications'
  | 'steps'
  | 'reference'
  | 'summary'

export interface ArticleSectionV3 {
  id: string
  heading: string
  sectionRole?: SectionRoleV3
  conceptFocus?: string[]
  targetReaderOutcome?: string
  sourceBlockIds: string[]
  paragraphs: ArticleParagraphV3[]
  subsections?: ArticleSectionV3[]
}

// --- Source-grounded callouts, tables, notes (DET-350) ----------------------

export type ArticleCalloutTypeV3 =
  | 'definition'
  | 'key_idea'
  | 'source_analogy'
  | 'caveat'
  | 'example'
  | 'warning'
  | 'remember'
  | 'compare'

export interface ArticleCalloutV3 {
  id: string
  type: ArticleCalloutTypeV3
  title?: string
  body: string
  sourceBlockIds: string[]
  relatedSectionIds?: string[]
  fidelityRisk?: FidelityRiskV3
  aiAssisted?: boolean
}

export interface CalloutPlacementMapV3 {
  bySection: Record<string, ArticleCalloutV3[]>
  unplaced: ArticleCalloutV3[]
}

export interface ArticleTableV3 {
  id: string
  title?: string
  columns: string[]
  rows: string[][]
  sourceBlockIds: string[]
  relatedSectionIds?: string[]
  fidelityRisk?: FidelityRiskV3
}

export type SourceNoteKindV3 =
  | 'reference'
  | 'bibliography'
  | 'external_link'
  | 'removed_navigation'
  | 'low_importance'

export interface SourceNoteV3 {
  id: string
  kind: SourceNoteKindV3
  text: string
  url?: string
  sourceBlockIds?: string[]
}

export interface SourceReferenceV3 {
  id: string
  label: string
  url?: string
  sourceBlockIds?: string[]
}

export interface SourceExampleV3 {
  id: string
  text: string
  sourceBlockIds: string[]
  relatedSectionIds?: string[]
}

// --- Learning layer (DET-351 / 352 / 353) -----------------------------------

export type ConceptCandidateTypeV3 =
  | 'core_concept'
  | 'supporting_concept'
  | 'term'
  | 'process'
  | 'distinction'
  | 'method'
  | 'model'
  | 'misconception'

export type ConceptRelationshipTypeV3 =
  | 'related_to'
  | 'prerequisite_of'
  | 'confused_with'
  | 'contrasts_with'
  | 'example_of'
  | 'applied_in'
  | 'misconception_about'

export interface ConceptRelationshipCandidateV3 {
  type: ConceptRelationshipTypeV3
  targetName: string
}

export interface ConceptCandidateV3 {
  id: string
  name: string
  normalizedName: string
  domain?: string
  type: ConceptCandidateTypeV3
  shortDefinition?: string
  sourceBlockIds: string[]
  articleSectionIds: string[]
  importance: 'high' | 'medium' | 'low'
  suggestedCognitiveState: 'Seen' | 'Parsed'
  relationshipCandidates?: ConceptRelationshipCandidateV3[]
  status?: 'ai_suggested' | 'user_validated' | 'rejected'
}

export type ClaimTypeV3 =
  | 'definition'
  | 'mechanism'
  | 'distinction'
  | 'historical_claim'
  | 'causal_claim'
  | 'classification'
  | 'example'
  | 'caveat'

export interface ClaimCandidateV3 {
  id: string
  text: string
  sourceBlockIds: string[]
  articleSectionIds: string[]
  claimType: ClaimTypeV3
  confidence: number
}

export interface TerminologyItemV3 {
  id: string
  term: string
  definition: string
  sourceBlockIds: string[]
}

export type RetrievalPromptTypeV3 =
  | 'definition'
  | 'mechanism'
  | 'distinction'
  | 'sequence'
  | 'analogy'
  | 'misconception_repair'
  | 'transfer'

export interface RetrievalPromptV3 {
  id: string
  question: string
  expectedAnswerSourceBlockIds: string[]
  relatedConceptCandidateIds: string[]
  promptType: RetrievalPromptTypeV3
  difficulty: 'easy' | 'medium' | 'hard'
  status: 'ai_suggested' | 'user_validated' | 'rejected'
}

export interface MisconceptionCandidateV3 {
  id: string
  misconception: string
  correction: string
  sourceBlockIds: string[]
  relatedConceptCandidateIds: string[]
  confidence: number
  status: 'ai_suggested' | 'validated' | 'rejected'
}

export interface LearningPathItemV3 {
  id: string
  label: string
  sectionId?: string
  outcome?: string
}

// --- Quality report (DET-354) -----------------------------------------------

export interface ArticleQualityReportV3 {
  sourceCoverageScore: number
  importantSourceCoverageScore: number
  citationCoverageScore: number
  unsupportedClaimCount: number
  highSeverityLostInfoCount: number
  conceptCandidateCount: number
  keyClaimCount: number
  retrievalPromptCount: number
  tableCount: number
  calloutCount: number
  exerciseReadinessScore: number
  articleReadabilityScore: number
  provenanceCompletenessScore: number
  reviewerWarnings: string[]
  blockerReasons: ArticleBlockerReason[]
  regenerationHints: string[]
}

// --- Top-level contract ------------------------------------------------------

export interface ArticleJsonV3 {
  schemaVersion: typeof ARTICLE_JSON_V3
  mode: typeof ARTICLE_V3_MODE
  status: ArticleStatusV3
  sourceKind: SourceKind
  shape: ArticleShapeV3
  title: ArticleTitleV3
  dek?: string
  abstract: ArticleParagraphV3[]
  learningPath: LearningPathItemV3[]
  sections: ArticleSectionV3[]
  keyConcepts: ConceptCandidateV3[]
  keyClaims: ClaimCandidateV3[]
  terminology: TerminologyItemV3[]
  sourceExamples: SourceExampleV3[]
  misconceptionWarnings: MisconceptionCandidateV3[]
  retrievalPrompts: RetrievalPromptV3[]
  calloutPlacements: CalloutPlacementMapV3
  tables: ArticleTableV3[]
  sourceNotes: SourceNoteV3[]
  references: SourceReferenceV3[]
  provenance: ArticleProvenanceV3
  qualityReport: ArticleQualityReportV3
  readingTimeMinutes?: number
  generatedAt?: string
}

// --- Helpers -----------------------------------------------------------------

/**
 * The discriminator the read boundary and reader share: a v3 learning article is
 * `schemaVersion: 'v3'` AND `mode: 'source_grounded_learning_article'`. The mode
 * check is what keeps an enriched-v2 article (which historically also carried a
 * `'v3'` stamp) from being mis-routed to the v3 reader.
 */
export function isArticleJsonV3(
  json: { schemaVersion?: string; mode?: string } | null | undefined,
): json is ArticleJsonV3 {
  return (
    !!json &&
    json.schemaVersion === ARTICLE_JSON_V3 &&
    json.mode === ARTICLE_V3_MODE
  )
}

/** A held-back status: a blocker gate or a pending regeneration (DET-355). */
export function isBlockedStatusV3(status: ArticleStatusV3): boolean {
  return status.startsWith('BLOCKED_') || status === 'NEEDS_REGENERATION'
}

/** A readable, gate-passed status the reader treats as a finished article. */
export function isReadableStatusV3(status: ArticleStatusV3): boolean {
  return status === 'READY_FOR_REVIEW' || status === 'FINAL'
}

/** A paragraph/callout is AI scaffolding when flagged or ungrounded in source. */
export function isAiScaffoldingV3(item: {
  aiAssisted?: boolean
  sourceBlockIds: string[]
}): boolean {
  return item.aiAssisted === true || item.sourceBlockIds.length === 0
}
