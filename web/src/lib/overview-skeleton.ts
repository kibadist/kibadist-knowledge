import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  type ConceptCandidateRef,
  type KeyTermRef,
  orderedBlocks,
  orderedSections,
  sectionKeyTerms,
} from './article-v2'

/**
 * Overview skeleton derivation (DET-280).
 *
 * Key-Term Overview Mode shows the article's conceptual skeleton *before* deep
 * reading. The skeleton is **non-persistent UI metadata** derived on render: per
 * DET-278 the shared Article JSON v2 contract only guarantees `section.heading`,
 * `section.key_terms`, and `section.concept_candidates`. The richer overview
 * fields this mode wants (a one-line summary, relationship phrases, per-term
 * occurrences) are *derived here* from the article's own content until/unless the
 * contract promotes them to first-class fields. Nothing here is written back, so
 * Overview Mode never mints concepts or notes (a hard non-goal of DET-280).
 *
 * Source-grounding rule: every term and phrase the overview surfaces comes from
 * the section's declared `key_terms`/`concept_candidates` or is lifted verbatim
 * from the article prose. We never invent terminology.
 */

/** A key term resolved with the context the overview needs to preview it. */
export interface OverviewTerm {
  term: string
  /** Concept candidate this term maps to, when the section declares one. */
  conceptCandidate?: ConceptCandidateRef
  /** Where the term first appears in the prose, for the click-to-preview panel. */
  occurrence?: TermOccurrence
}

export interface TermOccurrence {
  block_id: string
  /** A short verbatim window of prose around the term's first mention. */
  snippet: string
}

/** The derived, render-time skeleton for a single section. */
export interface SectionSkeleton {
  section: ArticleSectionV2
  /** Source-grounded key terms, resolved with concept + occurrence context. */
  keyTerms: OverviewTerm[]
  /** Concept candidates the section yields (DET-287 seeds; never promoted here). */
  coreConcepts: ConceptCandidateRef[]
  /** A one-line orientation sentence, lifted from the section's opening prose. */
  summarySentence?: string
  /** Verbatim relationship/definition phrases found in the prose (cue-matched). */
  relationships: string[]
}

/** Block kinds the overview collapses as "examples" (the detail, not the skeleton). */
const EXAMPLE_BLOCK_TYPES = new Set<ArticleBlockV2['type']>([
  'code',
  'table',
  'image',
])

/** Block kinds whose prose the overview blurs/deemphasises (layout preserved). */
const PROSE_BLOCK_TYPES = new Set<ArticleBlockV2['type']>([
  'paragraph',
  'quote',
  'list',
  'callout',
])

/** True for blocks the overview collapses behind a quiet "example" affordance. */
export function isExampleBlock(block: ArticleBlockV2): boolean {
  return EXAMPLE_BLOCK_TYPES.has(block.type)
}

/** True for the secondary-explanation blocks the overview obscures. */
export function isProseBlock(block: ArticleBlockV2): boolean {
  return PROSE_BLOCK_TYPES.has(block.type)
}

/**
 * Relationship/definition cues. A sentence containing one of these typically
 * states how a concept relates to another — exactly the connective tissue a
 * pre-reading skeleton should surface. Matched case-insensitively on word
 * boundaries so "increase" doesn't trip "is a".
 */
const RELATIONSHIP_CUES = [
  'is a',
  'is an',
  'is the',
  'are a',
  'refers to',
  'means that',
  'means',
  'defined as',
  'consists of',
  'depends on',
  'leads to',
  'results in',
  'because',
  'so that',
  'causes',
  'happens when',
]

const CUE_PATTERN = new RegExp(
  `\\b(?:${RELATIONSHIP_CUES.map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`,
  'i',
)

/** Split prose into sentences without dragging in an NLP dependency. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Build a word-boundaried, case-insensitive matcher for one term. */
function termMatcher(term: string): RegExp | null {
  const cleaned = term.trim()
  if (cleaned.length < 2) return null
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

/**
 * A short verbatim window around the term's first mention, clipped to whole
 * words with ellipses, so the preview reads naturally and never invents text.
 */
function buildSnippet(
  text: string,
  matchIndex: number,
  matchLen: number,
): string {
  const WINDOW = 48
  let start = Math.max(0, matchIndex - WINDOW)
  let end = Math.min(text.length, matchIndex + matchLen + WINDOW)
  // Snap to word boundaries so we don't cut mid-word.
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < matchIndex) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space !== -1 && space > matchIndex + matchLen) end = space
  }
  const core = text.slice(start, end).trim()
  return `${start > 0 ? '… ' : ''}${core}${end < text.length ? ' …' : ''}`
}

/** Find where a term first appears in a section's blocks (for click-to-preview). */
export function findTermOccurrence(
  term: string,
  blocks: ArticleBlockV2[],
): TermOccurrence | undefined {
  const matcher = termMatcher(term)
  if (!matcher) return undefined
  for (const block of blocks) {
    const text = blockPlainText(block)
    const match = matcher.exec(text)
    if (match) {
      return {
        block_id: block.block_id,
        snippet: buildSnippet(text, match.index, match[0].length),
      }
    }
  }
  return undefined
}

/**
 * When a section declares no `key_terms`, fall back to the terms the author
 * already emphasised in prose (bold/italic/code runs). These are still
 * source-grounded — lifted from the article — not invented.
 */
function emphasisedTerms(blocks: ArticleBlockV2[]): KeyTermRef[] {
  const seen = new Set<string>()
  const out: KeyTermRef[] = []
  for (const block of blocks) {
    const runs =
      block.type === 'paragraph' ||
      block.type === 'quote' ||
      block.type === 'heading' ||
      block.type === 'callout'
        ? block.content.runs
        : block.type === 'list'
          ? block.content.items.flat()
          : []
    for (const run of runs) {
      if (!run.marks || run.marks.length === 0) continue
      if (
        !run.marks.some((m) => m === 'bold' || m === 'italic' || m === 'code')
      )
        continue
      const term = run.text.trim().replace(/[.,;:]+$/, '')
      const key = term.toLowerCase()
      if (term.length < 2 || term.length > 40 || seen.has(key)) continue
      seen.add(key)
      out.push({ term, block_id: block.block_id })
    }
  }
  return out
}

/** Resolve the concept candidate a term maps to, by id then by label. */
function resolveConcept(
  ref: KeyTermRef,
  candidates: ConceptCandidateRef[],
): ConceptCandidateRef | undefined {
  if (ref.concept_candidate_id) {
    const byId = candidates.find((c) => c.id === ref.concept_candidate_id)
    if (byId) return byId
  }
  const lower = ref.term.trim().toLowerCase()
  return candidates.find((c) => c.label.trim().toLowerCase() === lower)
}

/** The first sentence of the section's opening paragraph — a quiet orientation. */
function deriveSummarySentence(blocks: ArticleBlockV2[]): string | undefined {
  const firstPara = blocks.find((b) => b.type === 'paragraph')
  if (!firstPara) return undefined
  const [sentence] = splitSentences(blockPlainText(firstPara))
  if (!sentence) return undefined
  // Keep it to a single readable line.
  return sentence.length > 200 ? `${sentence.slice(0, 197).trim()}…` : sentence
}

/** Verbatim relationship/definition phrases pulled from the section's prose. */
function deriveRelationships(
  blocks: ArticleBlockV2[],
  summary?: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  if (summary) seen.add(summary.toLowerCase())
  for (const block of blocks) {
    if (!isProseBlock(block)) continue
    for (const sentence of splitSentences(blockPlainText(block))) {
      if (sentence.length < 12 || sentence.length > 200) continue
      if (!CUE_PATTERN.test(sentence)) continue
      const key = sentence.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(sentence)
      if (out.length >= 2) return out
    }
  }
  return out
}

/** Derive the render-time skeleton for one section (pure; no persistence). */
export function deriveSectionSkeleton(
  section: ArticleSectionV2,
): SectionSkeleton {
  const blocks = orderedBlocks(section)
  const candidates = section.concept_candidates ?? []

  let refs = sectionKeyTerms(section)
  if (refs.length === 0) refs = emphasisedTerms(blocks)

  const keyTerms: OverviewTerm[] = refs.map((ref) => ({
    term: ref.term,
    conceptCandidate: resolveConcept(ref, candidates),
    occurrence: findTermOccurrence(ref.term, blocks),
  }))

  const summarySentence = deriveSummarySentence(blocks)

  return {
    section,
    keyTerms,
    coreConcepts: candidates,
    summarySentence,
    relationships: deriveRelationships(blocks, summarySentence),
  }
}

/** Derive the skeleton for every section, in persisted order. */
export function deriveArticleSkeleton(article: ArticleV2): SectionSkeleton[] {
  return orderedSections(article).map(deriveSectionSkeleton)
}
