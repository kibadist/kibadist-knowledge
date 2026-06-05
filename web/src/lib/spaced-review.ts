import type {
  ArticleLearningEvent,
  ReviewPromptStatus,
} from './article-learning-events'
import {
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  orderedBlocks,
  orderedSections,
  sectionKeyTerms,
} from './article-v2'

/**
 * Spaced Review Mode (DET-288) — pure, render-time prompt generation.
 *
 * Spaced Review is the mode that turns a one-time article into a recurring memory
 * object. After the learner predicts, rewrites, compares, or extracts concepts,
 * this module proposes future review prompts built from the user's *own*
 * explanations and validated concepts, falling back to source-grounded article
 * claims only when there isn't enough user-authored material. Approved prompts
 * are handed to the Retrieval Engine; nothing here schedules anything itself.
 *
 *   > An article is not learned when it is read. It is learned when the user can
 *   > retrieve and apply it later.
 *
 * What it produces, per prompt (DET-288 "Data requirements"):
 *  - a stable `prompt_id`, the article/section/concept it belongs to, the source
 *    spans backing it, and the `created_from_event_id` it was derived from;
 *  - a `prompt_type` (recall / misconception repair / contrast / transfer …),
 *    the `origin` of its content (the scheduling gate), a `question`, and an
 *    `expected_answer_summary` grounded in the right provenance layer;
 *  - a `status` (always `suggested` here — AI proposes; the user validates) and
 *    empty `schedule_metadata` until the Retrieval Engine schedules it.
 *
 * Coordination rules (DET-278), mirroring the executable server contract in
 * `server/src/article-learning/review-prompt.ts`:
 *  - §1 stable ids: a `prompt_id` is derived from the section/concept + prompt
 *    type + a slug of its subject, never an array index, so re-generation
 *    re-attaches the learner's approve/reject decision to the same prompt.
 *  - §2 events are the source of truth: nothing here writes a schedule; approval
 *    emits a `review_prompt_approved` event (the mode does that) and the prompt
 *    flows to the Retrieval Engine through an explicit sink.
 *  - §4 scheduling: every generated prompt is `suggested`. AI-generated prompts
 *    are never scheduled without user approval (a product non-goal to do so now).
 *  - §5 provenance: a user-authored prompt's expected answer is grounded in the
 *    learner's words; a source-faithful prompt's, in the article/source — the two
 *    layers are never collapsed.
 *
 * Non-goals honoured (DET-288): no spaced-repetition algorithm is built here (the
 * Retrieval Engine owns schedules); the default prompt set is small, not dozens;
 * AI-only content is clearly marked (`origin: 'ai_article_prose'`) and never
 * preferred over user-authored material.
 *
 * The heuristic is deterministic and client-side, like its sibling modes; the
 * shape is forward-compatible with a server/AI generation pass.
 */

// --- Vocabulary (mirrors server review-prompt.ts) ----------------------------

/** The kind of retrieval a prompt exercises (DET-288 "Prompt types"). */
export type ReviewPromptType =
  | 'definition_recall'
  | 'source_faithful_recall'
  | 'misconception_repair'
  | 'contrast'
  | 'transfer'
  | 'metaphor_guardrail'

/** The UX grouping prompts are shown under (DET-288 "grouped by type"). */
export type ReviewPromptGroup =
  | 'recall'
  | 'misconception'
  | 'contrast'
  | 'transfer'

/** Display order of the prompt groups. */
export const REVIEW_PROMPT_GROUPS: readonly ReviewPromptGroup[] = [
  'recall',
  'misconception',
  'contrast',
  'transfer',
]

const GROUP_BY_TYPE: Record<ReviewPromptType, ReviewPromptGroup> = {
  definition_recall: 'recall',
  source_faithful_recall: 'recall',
  misconception_repair: 'misconception',
  contrast: 'contrast',
  transfer: 'transfer',
  metaphor_guardrail: 'transfer',
}

/** The display group a prompt type belongs to. */
export function promptTypeGroup(type: ReviewPromptType): ReviewPromptGroup {
  return GROUP_BY_TYPE[type]
}

/**
 * Where a prompt's content originates — the dominant scheduling gate (DET-278
 * §4). Mirrors the server `PromptOrigin`. User-authored/approved origins are the
 * strongest; `ai_article_prose` is the weakest and never preferred.
 */
export type PromptOrigin =
  | 'user_authored_text'
  | 'corrected_rewrite'
  | 'approved_concept_candidate'
  | 'user_edited_concept'
  | 'missed_claim'
  | 'source_grounded_claim'
  | 'ai_article_prose'

/** How strongly we prefer an origin — higher wins when capping the prompt set. */
const ORIGIN_RANK: Record<PromptOrigin, number> = {
  user_edited_concept: 6,
  corrected_rewrite: 5,
  user_authored_text: 4,
  approved_concept_candidate: 4,
  missed_claim: 3,
  source_grounded_claim: 2,
  ai_article_prose: 1,
}

// --- The review-prompt record (DET-288 data requirements) --------------------

export interface ReviewPrompt {
  prompt_id: string
  article_id: string
  article_version_id?: string
  section_id?: string
  concept_id?: string
  source_span_ids: string[]
  created_from_event_id?: string
  prompt_type: ReviewPromptType
  origin: PromptOrigin
  question: string
  expected_answer_summary: string
  status: ReviewPromptStatus
  schedule_metadata: Record<string, unknown>
  /** The concept/term/section the prompt is about (display + de-dup key). */
  subject: string
  /** A snapshot of the section heading for the prompt's provenance label. */
  section_heading?: string
}

// --- Tokenisation / text helpers ---------------------------------------------

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

/** A url/id-safe slug (stable id component). */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'x'
  )
}

/** Split prose into sentence-sized chunks, keeping terminal punctuation. */
function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/** First `n` words of a string, with an ellipsis when truncated. */
function gist(text: string, n = 16): string {
  const words = text.trim().replace(/\s+/g, ' ').split(' ')
  if (words.length <= n) return words.join(' ')
  return `${words.slice(0, n).join(' ')}…`
}

/** Whether a text mentions a term as a whole word (case-insensitive). */
function mentions(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return false
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

/** The section's main claim — its first substantive sentence. */
function sectionMainClaim(section: ArticleSectionV2): string | null {
  for (const block of orderedBlocks(section)) {
    if (block.type === 'heading' || block.type === 'divider') continue
    const sentence = splitSentences(blockPlainText(block))[0]
    if (sentence && contentWordList(sentence).length >= 3) return sentence
  }
  return null
}

// --- ID minting --------------------------------------------------------------

/** A stable prompt id anchored on its scope + type + subject (§1). */
export function reviewPromptId(
  scopeId: string,
  type: ReviewPromptType,
  subject: string,
): string {
  return `rp_${scopeId}_${type}_${slugify(subject)}`
}

// --- Event mining ------------------------------------------------------------

/** A concept the learner approved in Concept Extraction Mode (DET-287). */
interface ApprovedConcept {
  eventId: string
  conceptId?: string
  sectionId?: string
  sourceSpanIds: string[]
  name: string
  definition?: string
  userExplanation?: string
  relatedConcepts: string[]
  confusionPairs: { concept: string; distinction: string }[]
  /** Whether the learner explained it in their own words (→ validated). */
  validated: boolean
}

/** A rewrite/correction the learner authored (DET-285/286). */
interface UserRewrite {
  eventId: string
  sectionId?: string
  blockId?: string
  text: string
  /** A correction made after Compare feedback ranks above a first attempt. */
  corrected: boolean
}

/** A divergence Compare & Repair surfaced (DET-286/282). */
interface MissedClaim {
  eventId: string
  sectionId?: string
  sourceSpanIds: string[]
  /** What the learner should reconstruct (the article's claim). */
  claim: string
  /** The misread belief, when the comparison flagged one. */
  belief?: string
  /** True when this came from a detected misconception, not a mere omission. */
  misconception: boolean
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/** Pull the approved concepts out of the learning-event log. */
function mineApprovedConcepts(
  events: ArticleLearningEvent[],
): ApprovedConcept[] {
  const byConcept = new Map<string, ApprovedConcept>()
  for (const event of events) {
    if (event.event_type !== 'concept_candidate_approved') continue
    const meta = event.metadata ?? {}
    const name = typeof meta.name === 'string' ? meta.name : undefined
    if (!name) continue
    const status = typeof meta.status === 'string' ? meta.status : undefined
    if (status === 'rejected') continue
    const explanation = event.user_answer?.trim()
    const confusionPairs = Array.isArray(meta.confusion_pairs)
      ? (meta.confusion_pairs as unknown[]).flatMap((p) => {
          if (p && typeof p === 'object') {
            const concept = (p as Record<string, unknown>).concept
            const distinction = (p as Record<string, unknown>).distinction
            if (typeof concept === 'string') {
              return [
                {
                  concept,
                  distinction:
                    typeof distinction === 'string' ? distinction : '',
                },
              ]
            }
          }
          return []
        })
      : []
    // Newest approval wins (stable concept id keys the map).
    const conceptId =
      typeof meta.concept_id === 'string' ? meta.concept_id : undefined
    byConcept.set(conceptId ?? name.toLowerCase(), {
      eventId: event.id,
      conceptId,
      sectionId: event.section_id,
      sourceSpanIds: event.source_span_ids ?? [],
      name,
      definition:
        typeof meta.definition === 'string' ? meta.definition : undefined,
      userExplanation: explanation || undefined,
      relatedConcepts: asStringArray(meta.related_concepts),
      confusionPairs,
      validated: Boolean(explanation) || status === 'user_validated',
    })
  }
  return [...byConcept.values()]
}

/** Pull the learner's rewrites (and corrections) out of the log. */
function mineRewrites(events: ArticleLearningEvent[]): UserRewrite[] {
  const out: UserRewrite[] = []
  for (const event of events) {
    const isRewrite =
      event.event_type === 'block_rewrite_submitted' ||
      event.event_type === 'rewrite_revised' ||
      event.event_type === 'prediction_submitted'
    if (!isRewrite) continue
    const text = event.user_answer?.trim()
    if (!text) continue
    out.push({
      eventId: event.id,
      sectionId: event.section_id,
      blockId: event.block_id,
      text,
      corrected: event.event_type === 'rewrite_revised',
    })
  }
  return out
}

/** Pull missed claims / detected misconceptions out of comparison events. */
function mineMissedClaims(events: ArticleLearningEvent[]): MissedClaim[] {
  const out: MissedClaim[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.event_type !== 'comparison_generated') continue
    const fb = event.ai_feedback
    if (!fb) continue
    const push = (claim: string, misconception: boolean, belief?: string) => {
      const trimmed = claim.trim()
      if (!trimmed) return
      const key = `${event.section_id ?? ''}|${trimmed.toLowerCase()}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({
        eventId: event.id,
        sectionId: event.section_id,
        sourceSpanIds: event.source_span_ids ?? [],
        claim: trimmed,
        belief,
        misconception,
      })
    }
    // Changed-meaning divergences are the truest misconceptions.
    for (const claim of fb.changed_meaning ?? []) push(claim, true)
    // Dropped ideas are recall gaps worth repairing.
    for (const claim of fb.missing ?? []) push(claim, false)
  }
  return out
}

// --- Generation --------------------------------------------------------------

export interface GenerateReviewPromptsOptions {
  /**
   * Cap on the number of prompts proposed by default (non-goal: not dozens). The
   * highest-ranked, most user-authored prompts are kept.
   */
  maxPrompts?: number
  /** Whether the original source spans behind the article are available (§5). */
  sourceAvailable?: boolean
}

const DEFAULT_MAX_PROMPTS = 8

/** Build the suggested-status review-prompt scaffold shared by all generators. */
function makePrompt(args: {
  scopeId: string
  prompt_type: ReviewPromptType
  origin: PromptOrigin
  subject: string
  question: string
  expected_answer_summary: string
  article: ArticleV2
  section_id?: string
  section_heading?: string
  concept_id?: string
  source_span_ids?: string[]
  created_from_event_id?: string
}): ReviewPrompt {
  return {
    prompt_id: reviewPromptId(args.scopeId, args.prompt_type, args.subject),
    article_id: args.article.article_id,
    article_version_id: args.article.article_version_id,
    section_id: args.section_id,
    concept_id: args.concept_id,
    source_span_ids: args.source_span_ids ?? [],
    created_from_event_id: args.created_from_event_id,
    prompt_type: args.prompt_type,
    origin: args.origin,
    question: args.question,
    expected_answer_summary: args.expected_answer_summary,
    status: 'suggested',
    schedule_metadata: {},
    subject: args.subject,
    section_heading: args.section_heading,
  }
}

/** Prompts derived from the learner's approved concepts (the strongest set). */
function promptsFromConcepts(
  article: ArticleV2,
  concepts: ApprovedConcept[],
): ReviewPrompt[] {
  const out: ReviewPrompt[] = []
  for (const concept of concepts) {
    const scopeId = concept.conceptId ?? concept.sectionId ?? article.article_id
    const heading = concept.sectionId
      ? sectionHeading(article, concept.sectionId)
      : undefined

    // Definition recall — prefer the learner's own explanation as the answer.
    out.push(
      makePrompt({
        scopeId,
        prompt_type: 'definition_recall',
        origin: concept.validated
          ? 'user_edited_concept'
          : 'approved_concept_candidate',
        subject: concept.name,
        question: `Explain ${concept.name} in your own words.`,
        expected_answer_summary:
          concept.userExplanation ??
          concept.definition ??
          `Your understanding of ${concept.name}.`,
        article,
        section_id: concept.sectionId,
        section_heading: heading,
        concept_id: concept.conceptId,
        source_span_ids: concept.sourceSpanIds,
        created_from_event_id: concept.eventId,
      }),
    )

    // Contrast — from the concept's confusion pairs.
    const pair = concept.confusionPairs[0]
    if (pair) {
      out.push(
        makePrompt({
          scopeId,
          prompt_type: 'contrast',
          origin: 'approved_concept_candidate',
          subject: `${concept.name} vs ${pair.concept}`,
          question: `How is ${concept.name} different from ${pair.concept}?`,
          expected_answer_summary:
            pair.distinction ||
            `What distinguishes ${concept.name} from ${pair.concept}.`,
          article,
          section_id: concept.sectionId,
          section_heading: heading,
          concept_id: concept.conceptId,
          source_span_ids: concept.sourceSpanIds,
          created_from_event_id: concept.eventId,
        }),
      )
    }

    // Transfer — application beyond the source (always approval-gated).
    out.push(
      makePrompt({
        scopeId,
        prompt_type: 'transfer',
        origin: 'approved_concept_candidate',
        subject: concept.name,
        question: `Where would ${concept.name} show up in a new situation?`,
        expected_answer_summary: `A fresh example or application of ${concept.name}.`,
        article,
        section_id: concept.sectionId,
        section_heading: heading,
        concept_id: concept.conceptId,
        source_span_ids: concept.sourceSpanIds,
        created_from_event_id: concept.eventId,
      }),
    )
  }
  return out
}

/** Prompts derived from the learner's rewrites (source-faithful recall). */
function promptsFromRewrites(
  article: ArticleV2,
  rewrites: UserRewrite[],
): ReviewPrompt[] {
  const out: ReviewPrompt[] = []
  const seenSections = new Set<string>()
  // Newest first; a correction outranks a first attempt for the same section.
  const ordered = [...rewrites].reverse()
  for (const rewrite of ordered) {
    const sectionId = rewrite.sectionId
    if (!sectionId) continue
    if (seenSections.has(sectionId)) continue
    seenSections.add(sectionId)
    const section = findSection(article, sectionId)
    if (!section) continue
    const subject = sectionSubject(section)
    out.push(
      makePrompt({
        scopeId: sectionId,
        prompt_type: 'source_faithful_recall',
        origin: rewrite.corrected ? 'corrected_rewrite' : 'user_authored_text',
        subject,
        question: `What was the main claim of “${section.heading}”?`,
        expected_answer_summary: gist(rewrite.text, 24),
        article,
        section_id: sectionId,
        section_heading: section.heading,
        source_span_ids: section.source_span_ids ?? [],
        created_from_event_id: rewrite.eventId,
      }),
    )
  }
  return out
}

/** Prompts derived from missed claims / detected misconceptions. */
function promptsFromMissedClaims(
  article: ArticleV2,
  missed: MissedClaim[],
): ReviewPrompt[] {
  const out: ReviewPrompt[] = []
  for (const item of missed) {
    const scopeId = item.sectionId ?? article.article_id
    const heading = item.sectionId
      ? sectionHeading(article, item.sectionId)
      : undefined
    if (item.misconception) {
      out.push(
        makePrompt({
          scopeId,
          prompt_type: 'misconception_repair',
          origin: 'missed_claim',
          subject: item.belief ?? item.claim,
          question: item.belief
            ? `Earlier you wrote “${gist(item.belief, 12)}”. Why is that interpretation wrong or incomplete?`
            : `Why is a common reading of “${gist(item.claim, 12)}” wrong or incomplete?`,
          expected_answer_summary: `The article's actual claim: ${gist(item.claim, 20)}`,
          article,
          section_id: item.sectionId,
          section_heading: heading,
          source_span_ids: item.sourceSpanIds,
          created_from_event_id: item.eventId,
        }),
      )
    } else {
      out.push(
        makePrompt({
          scopeId,
          prompt_type: 'source_faithful_recall',
          origin: 'missed_claim',
          subject: item.claim,
          question: `You dropped this idea last time — recall it: “${gist(item.claim, 12)}”. What did the article claim?`,
          expected_answer_summary: gist(item.claim, 24),
          article,
          section_id: item.sectionId,
          section_heading: heading,
          source_span_ids: item.sourceSpanIds,
          created_from_event_id: item.eventId,
        }),
      )
    }
  }
  return out
}

/**
 * Source-grounded fallback recall prompts from the article itself. Marked
 * `source_grounded_claim` when the section cites source spans, else the weaker
 * `ai_article_prose`. Only used to round out a thin set — never preferred.
 */
function promptsFromArticle(article: ArticleV2): ReviewPrompt[] {
  const out: ReviewPrompt[] = []
  for (const section of orderedSections(article)) {
    const claim = sectionMainClaim(section)
    if (!claim) continue
    const hasSource = (section.source_span_ids?.length ?? 0) > 0
    const subject = sectionSubject(section)
    out.push(
      makePrompt({
        scopeId: section.section_id,
        prompt_type: 'source_faithful_recall',
        origin: hasSource ? 'source_grounded_claim' : 'ai_article_prose',
        subject,
        question: `What was the section’s main claim about ${subject}?`,
        expected_answer_summary: gist(claim, 24),
        article,
        section_id: section.section_id,
        section_heading: section.heading,
        source_span_ids: section.source_span_ids ?? [],
      }),
    )
  }
  return out
}

// --- Section helpers ---------------------------------------------------------

function findSection(
  article: ArticleV2,
  sectionId: string,
): ArticleSectionV2 | undefined {
  return article.sections.find((s) => s.section_id === sectionId)
}

function sectionHeading(
  article: ArticleV2,
  sectionId: string,
): string | undefined {
  return findSection(article, sectionId)?.heading
}

/** A short subject label for a section — its first key term, else its heading. */
function sectionSubject(section: ArticleSectionV2): string {
  const term = sectionKeyTerms(section)[0]
  return term?.term ?? section.heading
}

// --- Public entry point ------------------------------------------------------

/**
 * Generate the suggested review-prompt set for an article from its learning-event
 * log. Prompts are gathered from the strongest sources first (validated concepts,
 * corrections, rewrites, missed claims) and only topped up with source-grounded
 * article claims if the set is thin. De-duplicated by `prompt_id`, ranked so the
 * most user-authored material survives the `maxPrompts` cap, and returned in
 * display-group order.
 */
export function generateReviewPrompts(
  article: ArticleV2,
  events: ArticleLearningEvent[],
  options: GenerateReviewPromptsOptions = {},
): ReviewPrompt[] {
  const max = options.maxPrompts ?? DEFAULT_MAX_PROMPTS

  const concepts = mineApprovedConcepts(events)
  const rewrites = mineRewrites(events)
  const missed = mineMissedClaims(events)

  const userAuthored = [
    ...promptsFromConcepts(article, concepts),
    ...promptsFromMissedClaims(article, missed),
    ...promptsFromRewrites(article, rewrites),
  ]

  // De-duplicate by stable id, keeping the highest-ranked origin for each.
  const byId = new Map<string, ReviewPrompt>()
  const consider = (prompt: ReviewPrompt) => {
    const existing = byId.get(prompt.prompt_id)
    if (
      !existing ||
      ORIGIN_RANK[prompt.origin] > ORIGIN_RANK[existing.origin]
    ) {
      byId.set(prompt.prompt_id, prompt)
    }
  }
  for (const prompt of userAuthored) consider(prompt)

  // Top up with source-grounded article prompts only if we're short, and never
  // displacing a user-authored prompt for the same subject.
  if (byId.size < max) {
    for (const prompt of promptsFromArticle(article)) {
      if (byId.size >= max) break
      if (!byId.has(prompt.prompt_id)) byId.set(prompt.prompt_id, prompt)
    }
  }

  const ranked = [...byId.values()].sort(
    (a, b) => ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin],
  )
  const kept = ranked.slice(0, max)

  // Return in display-group order so the mode can render grouped sections.
  return [...kept].sort(
    (a, b) =>
      REVIEW_PROMPT_GROUPS.indexOf(promptTypeGroup(a.prompt_type)) -
      REVIEW_PROMPT_GROUPS.indexOf(promptTypeGroup(b.prompt_type)),
  )
}

/** Group prompts by their display group, preserving group order. */
export function groupReviewPrompts(
  prompts: ReviewPrompt[],
): { group: ReviewPromptGroup; prompts: ReviewPrompt[] }[] {
  return REVIEW_PROMPT_GROUPS.map((group) => ({
    group,
    prompts: prompts.filter((p) => promptTypeGroup(p.prompt_type) === group),
  })).filter((g) => g.prompts.length > 0)
}

/** Whether the set covers at least recall, misconception, and transfer (AC). */
export function hasMinimumPromptVariety(prompts: ReviewPrompt[]): boolean {
  const groups = new Set(prompts.map((p) => promptTypeGroup(p.prompt_type)))
  return (
    groups.has('recall') &&
    groups.has('misconception') &&
    groups.has('transfer')
  )
}

// --- Labels (display vocabulary) ---------------------------------------------

export const REVIEW_PROMPT_TYPE_LABEL: Record<ReviewPromptType, string> = {
  definition_recall: 'Definition recall',
  source_faithful_recall: 'Source-faithful recall',
  misconception_repair: 'Misconception repair',
  contrast: 'Contrast',
  transfer: 'Transfer',
  metaphor_guardrail: 'Metaphor guardrail',
}

export const REVIEW_PROMPT_GROUP_LABEL: Record<ReviewPromptGroup, string> = {
  recall: 'Recall',
  misconception: 'Misconception repair',
  contrast: 'Contrast',
  transfer: 'Transfer & application',
}

/** A short, neutral label for a prompt's origin (provenance chip). */
export const PROMPT_ORIGIN_LABEL: Record<PromptOrigin, string> = {
  user_authored_text: 'From your rewrite',
  corrected_rewrite: 'From your correction',
  approved_concept_candidate: 'From a concept you saved',
  user_edited_concept: 'From your explanation',
  missed_claim: 'From what you missed',
  source_grounded_claim: 'From the source',
  ai_article_prose: 'From the article',
}

/** Whether a prompt's origin is user-authored/validated (vs AI-only). */
export function isUserAuthoredOrigin(origin: PromptOrigin): boolean {
  return origin !== 'ai_article_prose' && origin !== 'source_grounded_claim'
}
