/**
 * Article JSON v3 — the client-side contract for source-grounded learning
 * articles (DET-344, the "Source-Grounded Learning Article Engine" epic
 * DET-343).
 *
 * v3 is a PARALLEL shape to the legacy `source_preserving_article` v2 contract
 * (see `api.ts` `ArticleJsonV2`), not a replacement: the strangler-pattern
 * migration (DET-362) keeps v2 as a stable fallback while v3 generation rolls
 * out behind a feature flag. The reader dispatches on `schemaVersion` —
 * v2 articles keep rendering through the Compendium/MagazineArticle path, v3
 * articles render through the learning-first reader (DET-357).
 *
 * This file MIRRORS the server-side v3 contract being built in the transformer
 * (DET-344). It is intentionally self-contained — it imports nothing from
 * `api.ts` so the dependency runs one way (`api.ts` re-exports `ArticleJsonV3`
 * from here), and every field tolerates the additive evolution of the pipeline:
 * panels and sections are guarded so an article generated before a given stage
 * shipped simply omits that affordance rather than crashing the renderer.
 *
 * Source-trace invariant (DET-344): every paragraph, section, claim, concept,
 * callout, table, and prompt carries source-block ids so the reader can ground
 * each rendered fragment back in the original material. AI-assisted scaffolding
 * (a fragment with no source blocks, or `aiAssisted: true`) is rendered visually
 * distinct from source-grounded claims — never silently mixed in.
 */

export const ARTICLE_JSON_V3 = 'v3' as const

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

/**
 * The article lifecycle status. Anything `BLOCKED_*` (or `NEEDS_REGENERATION`)
 * is a held-back state the reader renders with its blocker reasons +
 * regeneration hints; `READY_FOR_REVIEW`/`FINAL` are the readable, passed states.
 */
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

/** Machine-readable blocker codes that map onto the quality-gate failures. */
export type ArticleBlockerCode =
  | 'low_coverage'
  | 'unsupported_claims'
  | 'missing_concepts'
  | 'fidelity'
  | 'lost_information'
  | 'weak_exercise_readiness'

/** A single reason an article is held back, with a pointer to its report entry. */
export interface ArticleBlockerReason {
  code: ArticleBlockerCode
  message: string
  /** Points at a quality-report field/warning (DET-355) so the reader can link. */
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

/** Provenance for the article as a whole (DET-344 `ArticleProvenance`). */
export interface ArticleProvenanceV3 {
  sourceId?: string
  sourceUrl?: string | null
  sourceKind: SourceKind
  captureMethod?: 'PASTE' | 'URL' | 'PDF'
  capturedAt?: string
  totalSourceBlocks?: number
  representedSourceBlocks?: number
  /** Whether the original source spans are still available behind this article. */
  sourceAvailable?: boolean
}

// --- Body content ------------------------------------------------------------

export interface ArticleTitleV3 {
  text: string
  /** Where the title came from — an inferred title is AI scaffolding, not source. */
  source?: 'original' | 'cleanedOriginal' | 'inferred'
}

/**
 * A body paragraph. `sourceBlockIds` ground it in the source; an empty array
 * (or `aiAssisted: true`) marks it as AI scaffolding the reader renders as
 * visually distinct from source-grounded prose.
 */
export interface ArticleParagraphV3 {
  id: string
  text: string
  sourceBlockIds: string[]
  transformationType?: TransformationTypeV3
  fidelityRisk?: FidelityRiskV3
  aiAssisted?: boolean
}

/** Source-grounded section role (DET-348 outline). Drives the small-caps label. */
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
  /** Concept names this section is built around (DET-348). */
  conceptFocus?: string[]
  /** What the reader should be able to do after this section (DET-348). */
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

/**
 * Where each callout is placed. `bySection` anchors a callout beside the section
 * it belongs to; `unplaced` ones have nowhere inline to live and render in a
 * trailing group. Full callout objects are embedded (mirrors the v2 placement
 * map) so the reader renders straight from the map.
 */
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

/**
 * Material moved OUT of the article body by default (DET-348/350): references,
 * bibliography, external links, stripped navigation/footer, and low-importance
 * source matter. Surfaced in the Source notes drawer, never as a body section.
 */
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

/**
 * An AI-suggested concept (DET-351). It is a PROPOSAL the reader reviews — never
 * auto-promoted to permanent knowledge. `status` defaults to `ai_suggested`.
 */
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

/**
 * An AI-suggested active-recall prompt (DET-353). Visible for review but never
 * scheduled permanently until the user validates or answers it.
 */
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

/** An ordered "what you'll learn" item (DET-348 `LearningPathItem`). */
export interface LearningPathItemV3 {
  id: string
  label: string
  /** The section this path item maps to, when known. */
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
  mode: 'source_grounded_learning_article'
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
  /** Precomputed reading time; the reader falls back to a word-count estimate. */
  readingTimeMinutes?: number
  generatedAt?: string
}

// --- Helpers -----------------------------------------------------------------

/**
 * The reader dispatch boundary: is this article JSON the v3 learning shape? Used
 * to route between the v3 learning-first reader and the legacy v2 Compendium so
 * v2 articles keep rendering unchanged (DET-357 acceptance criterion 1).
 */
export function isArticleJsonV3(
  json: { schemaVersion?: string; mode?: string } | null | undefined,
): json is ArticleJsonV3 {
  // Discriminate on BOTH schemaVersion AND mode: an enriched v2 article can carry
  // optional v3-era fields but stays `mode: 'source_preserving_article'`, so the
  // mode guard keeps it on the Compendium path and only the learning-first article
  // (`mode: 'source_grounded_learning_article'`) reaches this v3 reader (DET-343).
  return (
    !!json &&
    json.schemaVersion === ARTICLE_JSON_V3 &&
    json.mode === 'source_grounded_learning_article'
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

/** Plain text of a paragraph list, for word-count / a11y label scanning. */
export function v3PlainText(paragraphs: ArticleParagraphV3[]): string {
  return paragraphs.map((p) => p.text).join(' ')
}

const WORDS_PER_MINUTE = 220

/**
 * Reading time in minutes: the precomputed value when present, else a
 * deterministic word-count estimate over the abstract + every section body
 * (never returns 0 — a non-empty article is at least a one-minute read).
 */
export function v3ReadingMinutes(article: ArticleJsonV3): number {
  if (article.readingTimeMinutes && article.readingTimeMinutes > 0) {
    return article.readingTimeMinutes
  }
  const collect = (sections: ArticleSectionV3[]): string[] =>
    sections.flatMap((s) => [
      v3PlainText(s.paragraphs),
      ...collect(s.subsections ?? []),
    ])
  const text = [v3PlainText(article.abstract), ...collect(article.sections)]
    .join(' ')
    .trim()
  if (!text) return 0
  const words = text.split(/\s+/).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** A paragraph/callout is AI scaffolding when flagged or ungrounded in source. */
export function isAiScaffolding(item: {
  aiAssisted?: boolean
  sourceBlockIds: string[]
}): boolean {
  return item.aiAssisted === true || item.sourceBlockIds.length === 0
}
