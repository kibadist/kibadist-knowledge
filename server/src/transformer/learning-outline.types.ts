/**
 * Learning-first article outline — shared JSON contracts (DET-348).
 *
 * WHY this exists. The earlier reshaping plan (DET-252/273) reorders and groups
 * the SOURCE's own layout. That is faithful, but a Wikipedia "Systems" article
 * then keeps its source furniture — References, Bibliography, External links — as
 * body headings, and a spoken transcript becomes one isolated sentence per
 * "section". Kibadist is a learning app: it needs a LEARNING structure (a teaching
 * arc, concept-led sections, a misconception pass, source matter demoted to
 * notes), not a clone of the source's table of contents.
 *
 * This stage runs AFTER classification + the reshaping plan and BEFORE the rewrite
 * (article generator). It consumes `sourceKind`, the learning `articleShape`, the
 * classified blocks and the derived `SourceSegment[]`, and emits a `LearningOutline`
 * the generator rewrites the prose against. It carries NO new substance: every
 * section/note/callout/table cites real source blocks (the service re-checks every
 * id in code, exactly like the structure-model and plan stages), and every
 * deviation from source reading order is recorded in `reorderings` (audited by the
 * same pure util the plan + fidelity checker use).
 */

import type {
  ArticleReorderingAudit,
  HeadingSourceV2,
} from './transformer.types'

/**
 * What KIND of thing the source is, derived deterministically from the block
 * types/classifications (no LLM). It biases the default learning shape and the
 * outline prompt. `unknown` is the safe fallback.
 */
export type SourceKind =
  | 'transcript'
  | 'encyclopedia'
  | 'article'
  | 'research_paper'
  | 'tutorial'
  | 'reference'
  | 'unknown'

/**
 * The LEARNING shape of the article (DET-348). Distinct from the reshaping plan's
 * genre `ArticleShape` (explainer/argument/…): this names the TEACHING skeleton the
 * outline organises around.
 *  - `lesson_article`: preserve a teaching arc; convert speech into readable
 *    sections (transcripts, talks, lessons).
 *  - `concept_explainer`: organise around definition → boundaries → types →
 *    mechanisms → examples → applications → misconceptions.
 *  - `research_digest`: organise around question → method → evidence → results →
 *    limitations → implications.
 *  - `general`: no forced learning skeleton (mixed/uncertain sources).
 */
export type LearningArticleShape =
  | 'lesson_article'
  | 'concept_explainer'
  | 'research_digest'
  | 'general'

/**
 * The semantic role of a learning section. A superset of the plan's `SectionRole`
 * that adds the shape-specific roles DET-348 calls for (boundaries/types/mechanism/
 * application/misconception for concept_explainer; question/method/evidence/results/
 * limitations/implications for research_digest). The role is a teaching intent — it
 * is never trusted to add meaning; the section's cited blocks still ground it.
 */
export type LearningSectionRole =
  // shared / lesson_article
  | 'introduction'
  | 'concept'
  | 'background'
  | 'practice'
  | 'summary'
  | 'sourceNotes'
  // concept_explainer
  | 'definition'
  | 'boundaries'
  | 'types'
  | 'mechanism'
  | 'example'
  | 'application'
  | 'misconception'
  // research_digest
  | 'question'
  | 'method'
  | 'evidence'
  | 'results'
  | 'limitations'
  | 'implications'

/**
 * The KIND of a `SourceSegment` — a contiguous run of source blocks. `content`
 * carries the article's substance. The remaining kinds are SOURCE FURNITURE that a
 * learning article demotes to source notes (DET-348 acceptance: "Bibliography,
 * references, and external links are planned for source notes unless directly
 * needed"). Detected deterministically from the segment heading + block
 * classifications.
 */
export type SegmentKind =
  | 'content'
  | 'references'
  | 'bibliography'
  | 'externalLinks'
  | 'furtherReading'
  | 'citations'
  | 'seeAlso'
  | 'footer'
  | 'noise'

/** The source-note kinds — the segment kinds a learning article plans into notes. */
export const SOURCE_NOTE_SEGMENT_KINDS: ReadonlySet<SegmentKind> = new Set([
  'references',
  'bibliography',
  'externalLinks',
  'furtherReading',
  'citations',
  'seeAlso',
])

/**
 * A contiguous, deterministically derived run of source blocks (DET-348). The
 * outline stage plans over SEGMENTS (semantic chunks) rather than raw blocks so a
 * section can cite "the Boundaries discussion" by segment and still pin the exact
 * blocks. Built by `buildSourceSegments` — ZERO AI.
 */
export interface SourceSegment {
  /** Deterministic id: `seg1`, `seg2`, … in source order. */
  id: string
  kind: SegmentKind
  /** The block ids in this segment, in source order. */
  blockIds: string[]
  /** The heading block that opens the segment, when it began at a HEADING. */
  headingBlockId?: string
  /** The heading text (verbatim) when the segment began at a HEADING. */
  headingText?: string
  /** Original heading depth (1–6) when known. */
  headingLevel?: number
  /** The most common block classification in the segment (provenance hint). */
  dominantClassification: string
}

/** The article title proposal — text + provenance. */
export interface ArticleTitle {
  text: string
  source: HeadingSourceV2
}

/** One audited reading-order move (DET-275/348). Identical to the plan's audit. */
export type ReorderAuditEntry = ArticleReorderingAudit

/**
 * One rung of the learning path — the reader-facing arc. Each step names the
 * outcome the reader reaches and which section headings deliver it.
 */
export interface LearningPathItem {
  /** 1-based ordinal of this rung in the arc. */
  step: number
  /** What the reader can do/understand after this rung. */
  outcome: string
  /** Section headings (from `sections`) that deliver this rung. */
  sectionHeadings: string[]
}

/**
 * One learning section. Carries the DET-348 required fields: a teaching `heading`
 * + `sectionRole`, the `sourceSegmentIds`/`sourceBlockIds` it is built from, the
 * `conceptFocus` it teaches, the `requiredClaims` it must convey, and the
 * `targetReaderOutcome` it leaves the reader with. `headingSource` records heading
 * provenance (mirrors the plan/article vocabulary).
 */
export interface OutlineSection {
  heading: string
  headingSource: HeadingSourceV2
  /** REQUIRED when headingSource === 'inferred': why a heading was synthesised. */
  headingInferenceReason?: string
  sectionRole: LearningSectionRole
  sourceSegmentIds: string[]
  sourceBlockIds: string[]
  /** The single concept this section teaches (e.g. "system boundary"). */
  conceptFocus: string
  /** The source claims this section MUST convey (each grounded in its blocks). */
  requiredClaims: string[]
  /** What the reader should be able to do/understand after this section. */
  targetReaderOutcome: string
}

/** One demoted source-furniture entry (DET-348): a reference/bibliography/links group. */
export interface SourceNote {
  kind: SegmentKind
  /** The source blocks this note covers. */
  sourceBlockIds: string[]
  /** The segments this note covers (provenance). */
  sourceSegmentIds: string[]
  /** Why it was demoted to notes (e.g. "reference list, not teaching content"). */
  reason: string
}

/** The plan for the article's source-notes section (demoted source furniture). */
export interface SourceNotePlan {
  notes: SourceNote[]
}

/**
 * One planned teaching callout — a definition card, worked example, key idea or
 * misconception flagged for emphasis. A REFERENCE to source content, never new
 * substance: it cites the blocks it draws from.
 */
export interface CalloutPlan {
  kind: 'definition' | 'example' | 'caveat' | 'keyIdea' | 'misconception'
  text: string
  sourceBlockIds: string[]
  /** The section heading this callout sits beside, when known. */
  sectionHeading?: string
}

/** One planned table render, grounded in a source TABLE block. */
export interface TablePlan {
  caption?: string
  sourceBlockIds: string[]
  /** The section heading the table belongs to, when known. */
  sectionHeading?: string
  reason: string
}

/**
 * The learning-first article outline (DET-348). The artifact persisted on the
 * article and handed to the rewrite (generator) stage. Every id it cites is a real
 * source block/segment; every reorder is recorded in `reorderings`. `warnings`
 * records anything the deterministic guards could not fully resolve (e.g. an
 * unaudited move, a demoted section).
 */
export interface LearningOutline {
  sourceKind: SourceKind
  articleShape: LearningArticleShape
  title: ArticleTitle
  dek?: string
  learningPath: LearningPathItem[]
  sections: OutlineSection[]
  sourceNotesPlan: SourceNotePlan
  calloutPlan: CalloutPlan[]
  tablePlan: TablePlan[]
  reorderings: ReorderAuditEntry[]
  warnings: string[]
}
