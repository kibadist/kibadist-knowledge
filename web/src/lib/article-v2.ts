import type { InlineRun } from './api'

/**
 * Article JSON v2 — the shared coordination contract (DET-278).
 *
 * This is the canonical client-side shape for a *generated* article (distinct
 * from a captured `SourceDocument`, which is raw source/reference material).
 * Every learning mode in the "Generated Article Learning Modes" project
 * (DET-280/282/284/285/286/287/288) reads articles in this shape and anchors
 * its `article_learning_events` to the stable IDs defined here.
 *
 * ID rules (DET-278):
 *  - `article_id` is stable for a generated article version.
 *  - `section_id` and `block_id` are generated once and persisted — never
 *    recalculated on render, and never derived from array index alone.
 *  - If an article is materially regenerated, mint a new `article_id` (or
 *    `article_version_id`); learning events always point at the exact version
 *    they were created from.
 *
 * Renderer note (DET-284 integration): text-bearing blocks carry their inline
 * content as `InlineRun[]`, the same primitive the Reader already renders. That
 * lets Deep Reading Mode reuse the shared inline renderer instead of duplicating
 * article rendering logic.
 */

export const ARTICLE_JSON_V2 = 'article_json_v2' as const

/** A learning action that a section or block can expose as an entry point. */
export type LearningAffordance =
  | 'predict'
  | 'rewrite'
  | 'extract_concepts'
  | 'compare'
  | 'review'

/** A key term surfaced for a section (overview skeleton, in-prose highlight). */
export interface KeyTermRef {
  /** The surface form of the term as it appears in the article. */
  term: string
  /** Block the term is anchored in, when known. */
  block_id?: string
  /** Concept candidate this term maps to, when extraction has run. */
  concept_candidate_id?: string
}

/** A concept candidate proposed from a section (consumed by DET-287). */
export interface ConceptCandidateRef {
  id: string
  label: string
}

// --- Typed block content -----------------------------------------------------
// DET-278 types `ArticleBlockV2.content` as `unknown` at the storage boundary.
// On the client we narrow it to a discriminated union so the renderer is total
// and type-safe. The structural shape stays article_json_v2 compatible.

export interface ParagraphBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'paragraph'
  content: { runs: InlineRun[] }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface HeadingBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'heading'
  content: { level: 1 | 2 | 3; runs: InlineRun[] }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface ListBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'list'
  content: { ordered: boolean; items: InlineRun[][] }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface QuoteBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'quote'
  content: { runs: InlineRun[]; attribution?: string }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface TableBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'table'
  content: { header: boolean; rows: string[][] }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface CodeBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'code'
  content: { language?: string; text: string }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

/** A callout/aside — the one block type with no `SourceDocument` analogue. */
export type CalloutVariant = 'note' | 'tip' | 'warning' | 'insight'

export interface CalloutBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'callout'
  content: { variant?: CalloutVariant; title?: string; runs: InlineRun[] }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface ImageBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'image'
  content: { src: string; alt?: string; caption?: string }
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface DividerBlock {
  block_id: string
  section_id: string
  order_index: number
  type: 'divider'
  content: null
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export type ArticleBlockV2 =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | TableBlock
  | CodeBlock
  | CalloutBlock
  | ImageBlock
  | DividerBlock

export type ArticleBlockType = ArticleBlockV2['type']

export interface ArticleSectionV2 {
  section_id: string
  heading: string
  order_index: number
  key_terms?: KeyTermRef[]
  concept_candidates?: ConceptCandidateRef[]
  source_span_ids?: string[]
  blocks: ArticleBlockV2[]
}

export interface ArticleV2 {
  article_id: string
  /** Distinguishes article versions when an article is regenerated materially. */
  article_version_id?: string
  source_id: string
  schema_version: typeof ARTICLE_JSON_V2
  title: string
  generated_at: string
  sections: ArticleSectionV2[]
}

// --- Helpers -----------------------------------------------------------------

/** Sections sorted by their persisted order, defensively (never trust input order). */
export function orderedSections(article: ArticleV2): ArticleSectionV2[] {
  return [...article.sections].sort((a, b) => a.order_index - b.order_index)
}

/** Blocks of a section sorted by persisted order. */
export function orderedBlocks(section: ArticleSectionV2): ArticleBlockV2[] {
  return [...section.blocks].sort((a, b) => a.order_index - b.order_index)
}

/** Flatten a block's inline runs to plain text (key-term scanning, a11y labels). */
export function blockPlainText(block: ArticleBlockV2): string {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
    case 'heading':
    case 'callout':
      return block.content.runs.map((r) => r.text).join('')
    case 'list':
      return block.content.items
        .map((item) => item.map((r) => r.text).join(''))
        .join(' ')
    case 'code':
      return block.content.text
    case 'table':
      return block.content.rows.flat().join(' ')
    case 'image':
      return block.content.caption ?? block.content.alt ?? ''
    case 'divider':
      return ''
  }
}

/** All key terms across a section, de-duplicated by surface form (case-insensitive). */
export function sectionKeyTerms(section: ArticleSectionV2): KeyTermRef[] {
  const seen = new Set<string>()
  const out: KeyTermRef[] = []
  for (const ref of section.key_terms ?? []) {
    const key = ref.term.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * The default set of section-level entry points when an article doesn't pin
 * explicit `learning_affordances`. Deep Reading Mode is the hub that connects
 * passive reading to these active modes (DET-278 event mapping).
 */
export const DEFAULT_SECTION_AFFORDANCES: LearningAffordance[] = [
  'predict',
  'rewrite',
  'extract_concepts',
]

/** Resolve the affordances a section should expose (explicit, else default). */
export function sectionAffordances(
  section: ArticleSectionV2,
): LearningAffordance[] {
  const fromBlocks = new Set<LearningAffordance>()
  for (const block of section.blocks) {
    for (const a of block.learning_affordances ?? []) fromBlocks.add(a)
  }
  if (fromBlocks.size > 0) return [...fromBlocks]
  return DEFAULT_SECTION_AFFORDANCES
}
