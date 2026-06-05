import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  orderedBlocks,
  orderedSections,
  sectionKeyTerms,
} from './article-v2'

/**
 * Concept Extraction Mode (DET-287) — pure, render-time logic.
 *
 * Concept Extraction is the mode that turns a *read* article into validated,
 * durable knowledge. Reading proves comprehension; extraction forces the learner
 * to decide which ideas are worth keeping. This module proposes concept
 * *candidates* from a section (or the whole article) — it never promotes one. The
 * product thesis it encodes: the article is temporary; validated concepts are the
 * durable learning layer.
 *
 * What it produces, per candidate (DET-287 data requirements):
 *  - a name and a *source-grounded* scaffold definition (the AI's words, never
 *    the learner's — see DET-287 AC "AI-suggested ≠ user-authored");
 *  - the article section it was drawn from and the source span ids backing it;
 *  - the learner's own rewrite snippet that mentions it, when Rewrite Mode
 *    (DET-285) has run for that section (a supporting explanation, kept distinct
 *    from the AI definition);
 *  - related concepts and possible confusion pairs (graph + Living-Concept feed);
 *  - suggested retrieval prompts (Retrieval Engine feed) — *suggested only*.
 *
 * Coordination rules (DET-278):
 *  - §1 stable ids: a candidate's `candidate_id` is derived from the persisted
 *    `section_id` + a slug of its name, never an array index, so re-extraction
 *    re-attaches a learner's decision to the same candidate.
 *  - §2 events are the source of truth: nothing here writes to the Concept
 *    Library; approval emits a `concept_candidate_approved` event and the durable
 *    concept is saved through an explicit sink. Suggestion ≠ saving.
 *  - §4 prompt scheduling: retrieval prompts default to `suggested`; they are
 *    never scheduled until the user validates the concept.
 *  - §5 source provenance: the AI definition traces to the article/source layer;
 *    the user explanation is its own (user-authored) layer and the two are never
 *    collapsed.
 *
 * Non-goals honoured (DET-287): not every key term becomes a concept worth
 * saving — terms are *suggested* and the learner gates them; no concept persona
 * is minted here (a candidate merely carries the literal definition,
 * misconceptions, confusion pairs and prompts a Living Concept could later use);
 * no large concept graph is materialised without review.
 *
 * The heuristic is deterministic and client-side, mirroring how the sibling modes
 * run at render time. The shape is forward-compatible with a server/AI pass: a
 * backend could populate the very same `ConceptCandidate` with richer semantics.
 */

/** The validation lifecycle of a concept candidate (DET-287 recommended states). */
export type ConceptCandidateStatus =
  | 'suggested'
  | 'draft'
  | 'user_validated'
  | 'rejected'

/** Where a candidate came from — drives the "suggested" provenance label. */
export type ConceptOrigin = 'generator_seed' | 'key_term'

/** A concept this candidate is easily confused with, plus a distinguishing cue. */
export interface ConfusionPair {
  /** The other concept's name. */
  concept: string
  /** A short cue for how the two differ — never asserted as fact, a prompt. */
  distinction: string
}

/**
 * A single concept candidate proposed from an article section (DET-287 data
 * requirements). It is a *suggestion*: it enters the Concept Library only when
 * the learner approves it, and is only `user_validated` once they have provided
 * or approved an explanation.
 */
export interface ConceptCandidate {
  candidate_id: string
  article_id: string
  article_version_id?: string
  section_id: string
  /** The section heading, snapshotted for the candidate's provenance label. */
  section_heading: string
  source_span_ids: string[]
  name: string
  /** AI-suggested, source-grounded scaffold definition. Never the learner's words. */
  definition: string
  /** Why the idea matters, when the section supplies an insight/callout for it. */
  why_it_matters?: string
  /** The learner's own explanation (verbatim) once provided or approved. */
  user_explanation?: string
  /**
   * A snippet from the learner's Rewrite-Mode reconstruction that mentions this
   * concept, offered as a *candidate* explanation they can adopt. Kept separate
   * from `user_explanation` until they accept it.
   */
  rewrite_snippet?: string
  related_concepts: string[]
  confusion_pairs: ConfusionPair[]
  retrieval_prompt_candidates: string[]
  status: ConceptCandidateStatus
  origin: ConceptOrigin
}

/** A learner reconstruction available as a supporting explanation (from DET-285). */
export interface UserRewriteSnippet {
  section_id: string
  block_id?: string
  /** The reconstruction text, verbatim. */
  text: string
}

export interface ExtractOptions {
  /**
   * Learner rewrites (newest last) to mine for supporting explanations. When a
   * rewrite mentions a candidate, the sentence is offered as `rewrite_snippet`.
   */
  userRewrites?: UserRewriteSnippet[]
  /** Cap candidates proposed per section (non-goal: not every term is a concept). */
  maxPerSection?: number
}

const DEFAULT_MAX_PER_SECTION = 6

// --- Tokenisation ------------------------------------------------------------

/** Generic filler we never treat as a salient content word. */
const STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'into',
  'your',
  'you',
  'and',
  'but',
  'for',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'its',
  'their',
  'they',
  'them',
  'will',
  'would',
  'can',
  'could',
  'should',
  'about',
  'which',
  'when',
  'what',
  'how',
  'why',
  'each',
  'every',
  'some',
  'such',
  'also',
  'just',
  'like',
  'more',
  'most',
  'only',
  'over',
  'than',
  'then',
  'there',
  'here',
  'one',
  'two',
  'use',
  'used',
  'using',
])

/** Significant content words in a text, in order, with duplicates kept. */
function contentWordList(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9'-]+/)) {
    const word = raw.replace(/^[-']+|[-']+$/g, '')
    if (word.length < 3 || STOPWORDS.has(word)) continue
    out.push(word)
  }
  return out
}

/** Significant content words of a concept name (for similarity comparisons). */
function nameWords(name: string): Set<string> {
  return new Set(contentWordList(name))
}

/** A url/id-safe slug of a concept name (stable id component). */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'concept'
  )
}

/** Normalised key for de-duplicating concept names case-/space-insensitively. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Title-case a key-term surface form for display as a concept name. */
function toConceptName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  // Preserve an already-capitalised or acronym form; otherwise sentence-case it.
  if (/[A-Z]/.test(trimmed)) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

// --- Sentence / span helpers -------------------------------------------------

/** Split prose into sentence-sized chunks, keeping terminal punctuation. */
function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Whether a text mentions the term as a whole word (case-insensitive). */
function mentions(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return false
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

/** First sentence of `text` that mentions `term`, else null. */
function sentenceMentioning(text: string, term: string): string | null {
  for (const sentence of splitSentences(text)) {
    if (mentions(sentence, term)) return sentence.trim()
  }
  return null
}

/** First substantive sentence in a section (definition fallback). */
function firstSubstantiveSentence(section: ArticleSectionV2): string | null {
  for (const block of orderedBlocks(section)) {
    if (block.type === 'heading' || block.type === 'divider') continue
    const sentence = splitSentences(blockPlainText(block))[0]
    if (sentence && contentWordList(sentence).length >= 2) return sentence
  }
  return null
}

/**
 * Locate where a term is defined in a section: the first block (preferring an
 * explicit `hintBlockId`) whose text mentions it. Returns the block and the
 * sentence, so both the scaffold definition and the source spans are grounded.
 */
function locateDefinition(
  section: ArticleSectionV2,
  term: string,
  hintBlockId?: string,
): { block: ArticleBlockV2; sentence: string } | null {
  const blocks = orderedBlocks(section)
  const ordered = hintBlockId
    ? [
        ...blocks.filter((b) => b.block_id === hintBlockId),
        ...blocks.filter((b) => b.block_id !== hintBlockId),
      ]
    : blocks
  for (const block of ordered) {
    if (block.type === 'divider') continue
    const sentence = sentenceMentioning(blockPlainText(block), term)
    if (sentence) return { block, sentence }
  }
  return null
}

/** The first insight/tip/note callout in a section — a "why it matters" source. */
function sectionInsight(section: ArticleSectionV2): string | undefined {
  for (const block of orderedBlocks(section)) {
    if (block.type !== 'callout') continue
    const variant = block.content.variant
    if (variant === 'insight' || variant === 'tip' || variant === 'note') {
      const text = blockPlainText(block).trim()
      if (text) return text
    }
  }
  return undefined
}

// --- Seed gathering ----------------------------------------------------------

interface Seed {
  name: string
  origin: ConceptOrigin
  /** Block hint from a key term, when the generator anchored it. */
  blockId?: string
}

/**
 * The ordered, de-duplicated concept seeds for a section. Explicit generator
 * `concept_candidates` come first (highest-signal), then key terms reused from
 * Overview Mode (DET-280). Per the non-goal, key terms are *suggested*, not
 * promoted — the learner still gates each one.
 */
function sectionSeeds(section: ArticleSectionV2): Seed[] {
  const seen = new Set<string>()
  const out: Seed[] = []
  const add = (name: string, origin: ConceptOrigin, blockId?: string) => {
    const cleaned = name.trim()
    if (!cleaned) return
    const key = nameKey(cleaned)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name: toConceptName(cleaned), origin, blockId })
  }
  for (const ref of section.concept_candidates ?? []) {
    add(ref.label, 'generator_seed')
  }
  for (const term of sectionKeyTerms(section)) {
    add(term.term, 'key_term', term.block_id)
  }
  return out
}

// --- Relations ---------------------------------------------------------------

/** Other candidate names in the same section — the related-concept edges. */
function relatedFor(name: string, siblings: string[]): string[] {
  const key = nameKey(name)
  return siblings.filter((s) => nameKey(s) !== key)
}

/**
 * Possible confusion pairs for a concept: related siblings that either share a
 * content word with it (lexical adjacency) or, failing that, the nearest sibling
 * — the ideas most worth being able to tell apart. The distinction is framed as a
 * prompt, never asserted as fact.
 */
function confusionFor(
  name: string,
  heading: string,
  related: string[],
): ConfusionPair[] {
  if (related.length === 0) return []
  const own = nameWords(name)
  const lexical = related.filter((other) => {
    const otherWords = nameWords(other)
    for (const w of own) if (otherWords.has(w)) return true
    return false
  })
  const chosen = (lexical.length > 0 ? lexical : related.slice(0, 1)).slice(
    0,
    2,
  )
  return chosen.map((concept) => ({
    concept,
    distinction: `Both come up in “${heading}” — be able to say how ${name} differs from ${concept}.`,
  }))
}

/** Suggested retrieval prompts for a concept (Retrieval Engine feed). */
function retrievalPromptsFor(
  name: string,
  hasWhy: boolean,
  confusion: ConfusionPair[],
): string[] {
  const prompts = [`What is ${name}?`]
  if (hasWhy) prompts.push(`Why does ${name} matter?`)
  prompts.push(`Explain ${name} in your own words.`)
  if (confusion[0]) {
    prompts.push(`How is ${name} different from ${confusion[0].concept}?`)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of prompts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.slice(0, 4)
}

/**
 * The learner's own words about a concept, mined from their Rewrite-Mode
 * reconstructions (DET-285). Prefers a rewrite from the same section, newest
 * first; returns the sentence that mentions the concept, verbatim.
 */
function rewriteSnippetFor(
  name: string,
  sectionId: string,
  rewrites: UserRewriteSnippet[],
): string | undefined {
  const ordered = [...rewrites].reverse() // newest first
  const sameSection = ordered.filter((r) => r.section_id === sectionId)
  for (const pool of [sameSection, ordered]) {
    for (const rewrite of pool) {
      const sentence = sentenceMentioning(rewrite.text, name)
      if (sentence) return sentence
    }
  }
  return undefined
}

// --- Extraction --------------------------------------------------------------

/** A stable candidate id anchored on the section + a slug of the name (§1). */
export function conceptCandidateId(sectionId: string, name: string): string {
  return `cand_${sectionId}_${slugify(name)}`
}

/** The durable concept id minted when a candidate is approved into the Library. */
export function conceptIdForCandidate(name: string): string {
  return `concept_${slugify(name)}`
}

/**
 * Extract concept candidates from a single section. Deterministic and
 * source-grounded: definitions come from the section's prose, spans from the
 * defining block, related/confusion edges from sibling candidates, and any
 * learner rewrite that mentions a concept is offered as a supporting snippet.
 */
export function extractSectionConcepts(
  article: ArticleV2,
  section: ArticleSectionV2,
  options: ExtractOptions = {},
): ConceptCandidate[] {
  const max = options.maxPerSection ?? DEFAULT_MAX_PER_SECTION
  const rewrites = options.userRewrites ?? []
  const seeds = sectionSeeds(section).slice(0, max)
  const allNames = seeds.map((s) => s.name)
  const insight = sectionInsight(section)

  return seeds.map((seed) => {
    const located = locateDefinition(section, seed.name, seed.blockId)
    const definition =
      located?.sentence ??
      firstSubstantiveSentence(section) ??
      `A key idea from “${section.heading}”.`
    const source_span_ids =
      located?.block.source_span_ids ?? section.source_span_ids ?? []

    const related = relatedFor(seed.name, allNames)
    const confusion = confusionFor(seed.name, section.heading, related)
    // A callout-sourced "why it matters" only applies when it isn't just the
    // definition restated; keep it when it adds something.
    const why_it_matters =
      insight && nameKey(insight) !== nameKey(definition) ? insight : undefined

    return {
      candidate_id: conceptCandidateId(section.section_id, seed.name),
      article_id: article.article_id,
      article_version_id: article.article_version_id,
      section_id: section.section_id,
      section_heading: section.heading,
      source_span_ids,
      name: seed.name,
      definition,
      why_it_matters,
      rewrite_snippet: rewriteSnippetFor(
        seed.name,
        section.section_id,
        rewrites,
      ),
      related_concepts: related.slice(0, 5),
      confusion_pairs: confusion,
      retrieval_prompt_candidates: retrievalPromptsFor(
        seed.name,
        Boolean(why_it_matters),
        confusion,
      ),
      status: 'suggested',
      origin: seed.origin,
    }
  })
}

/** Extract candidates across the whole article, grouped by section order. */
export function extractArticleConcepts(
  article: ArticleV2,
  options: ExtractOptions = {},
): ConceptCandidate[] {
  return orderedSections(article).flatMap((section) =>
    extractSectionConcepts(article, section, options),
  )
}

/**
 * The status an approved candidate earns (DET-287 validation rule): a concept is
 * only `user_validated` when the learner has provided or approved an explanation
 * (their own words, or an adopted rewrite snippet). Without one it enters the
 * Library as a `draft` pending that proof of learning.
 */
export function resolveApprovedStatus(
  explanation: string | undefined,
): Extract<ConceptCandidateStatus, 'draft' | 'user_validated'> {
  return explanation && explanation.trim().length > 0
    ? 'user_validated'
    : 'draft'
}

/** A neutral, human label for a candidate status (for chips/markers). */
export const CONCEPT_STATUS_LABEL: Record<ConceptCandidateStatus, string> = {
  suggested: 'Suggested',
  draft: 'Draft',
  user_validated: 'Validated',
  rejected: 'Rejected',
}

/** A short, neutral label for a candidate's origin (provenance chip). */
export const CONCEPT_ORIGIN_LABEL: Record<ConceptOrigin, string> = {
  generator_seed: 'Proposed concept',
  key_term: 'From key term',
}
