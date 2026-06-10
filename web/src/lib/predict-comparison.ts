import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  blockPlainText,
  orderedBlocks,
  sectionKeyTerms,
} from './article-v2'

/**
 * Predict-before-reveal comparison (DET-282).
 *
 * Predict Before Reveal Mode asks the learner to explain a section *before*
 * reading it, then reveals the prose and shows a lightweight comparison between
 * their prediction and what the article actually says. This module is the pure,
 * render-time logic behind that comparison: given a section and the learner's
 * free-text prediction, it derives four clearly-separated buckets —
 *
 *   - matched expectations   (ideas they anticipated correctly)
 *   - missing ideas          (key ideas the article covers, they didn't mention)
 *   - incorrect assumptions  (things they asserted the section doesn't address)
 *   - surprising additions   (specifics the article highlights they didn't predict)
 *
 * Design rules (DET-278 coordination + DET-282 non-goals):
 *  - Source-grounded: every "expected idea" comes from the section's declared
 *    `key_terms`/`concept_candidates` or is lifted verbatim from the prose. We
 *    never invent terminology to grade against.
 *  - Non-persistent UI metadata: this is derived on render, never written back.
 *    A prediction is not a concept and not a note (DET-278). Nothing here mints
 *    Concept Library entries or schedules review prompts.
 *  - Gentle, not a grader: the comparison is corrective feedback, not a score
 *    (DET-282 non-goal "do not grade the user harshly"). The buckets are framed
 *    as observations; an empty bucket is simply omitted by the UI.
 *
 * The heuristic is deliberately lexical (word-boundary, case-insensitive term
 * matching) rather than an AI call: Predict Mode runs entirely client-side at
 * reveal time, and the contract reserves AI-graded feedback + provenance for the
 * Compare & Repair flow (DET-286). The shape here is forward-compatible with a
 * richer comparison: a server could later populate the same buckets.
 */

/** The prompt the learner answers, stored verbatim on `prediction_submitted`. */
export const PREDICT_PROMPT = 'What do you think this section will explain?'

/** The four comparison buckets, each a list of short source-grounded strings. */
export interface PredictionComparison {
  /** Key ideas the learner predicted that the article also covers. */
  matched: string[]
  /** Key ideas the article covers that the learner did not mention. */
  missing: string[]
  /** Salient terms the learner asserted that the section does not address. */
  incorrect: string[]
  /** Specifics the article emphasises that the learner did not predict. */
  surprising: string[]
}

/** True when a comparison has nothing to show (e.g. an empty prediction). */
export function isEmptyComparison(c: PredictionComparison): boolean {
  return (
    c.matched.length === 0 &&
    c.missing.length === 0 &&
    c.incorrect.length === 0 &&
    c.surprising.length === 0
  )
}

// --- Tokenisation ------------------------------------------------------------

/**
 * Function words and prediction-frame filler we never treat as a claim. Kept
 * small and generic — the goal is to drop "the/this/will" and hedging verbs the
 * learner uses to frame a guess, not to do real NLP.
 */
const STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'they',
  'them',
  'their',
  'there',
  'will',
  'would',
  'should',
  'could',
  'might',
  'maybe',
  'probably',
  'guess',
  'think',
  'thing',
  'things',
  'about',
  'which',
  'with',
  'without',
  'into',
  'from',
  'some',
  'something',
  'because',
  'while',
  'when',
  'where',
  'what',
  'whatever',
  'have',
  'has',
  'had',
  'been',
  'being',
  'does',
  'doing',
  'done',
  'also',
  'just',
  'like',
  'very',
  'much',
  'more',
  'most',
  'such',
  'than',
  'then',
  'they',
  'your',
  'you',
  'and',
  'but',
  'for',
  'are',
  'was',
  'were',
  'how',
  'why',
  'its',
  "it's",
  'explain',
  'explains',
  'section',
  'article',
  'talk',
  'talks',
  'cover',
  'covers',
  'describe',
  'describes',
  'mean',
  'means',
  'idea',
  'ideas',
  'concept',
  'concepts',
  'probably',
  'likely',
  'going',
])

/** Significant content words in a prediction (lowercased, deduped, len >= 4). */
export function predictionTokens(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9'-]+/)) {
    const word = raw.replace(/^[-']+|[-']+$/g, '')
    if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}

/** A word-boundaried, case-insensitive matcher for a term (null if too short). */
function termMatcher(term: string): RegExp | null {
  const cleaned = term.trim()
  if (cleaned.length < 2) return null
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

/** Whether `term` appears as a whole word/phrase anywhere in `haystack`. */
function mentions(haystack: string, term: string): boolean {
  const matcher = termMatcher(term)
  return matcher ? matcher.test(haystack) : false
}

// --- Article-side extraction -------------------------------------------------

/**
 * The ideas a section is "about": its source-grounded key terms plus any
 * concept-candidate labels, de-duplicated case-insensitively, surface form kept.
 */
export function expectedIdeas(section: ArticleSectionV2): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (term: string) => {
    const key = term.trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(term.trim())
  }
  for (const ref of sectionKeyTerms(section)) push(ref.term)
  for (const candidate of section.concept_candidates ?? [])
    push(candidate.label)
  return out
}

/** Emphasised (bold/italic/code) terms lifted verbatim from a block's runs. */
function emphasisedTerms(block: ArticleBlockV2): string[] {
  const runs =
    block.type === 'paragraph' ||
    block.type === 'quote' ||
    block.type === 'heading' ||
    block.type === 'callout'
      ? block.content.runs
      : block.type === 'list'
        ? block.content.items.flat()
        : []
  const out: string[] = []
  for (const run of runs) {
    if (
      !run.marks?.some((m) => m === 'bold' || m === 'italic' || m === 'code')
    ) {
      continue
    }
    const term = run.text.trim().replace(/[.,;:]+$/, '')
    if (term.length >= 2 && term.length <= 40) out.push(term)
  }
  return out
}

/** A human label for an example block the overview folds away (code/table/etc). */
function exampleLabel(block: ArticleBlockV2): string | null {
  switch (block.type) {
    case 'code':
      return block.content.language
        ? `a ${block.content.language} code example`
        : 'a worked code example'
    case 'equation':
      return 'an equation'
    case 'table':
      return 'a comparison table'
    case 'image':
      return block.content.caption ?? 'a figure'
    default:
      return null
  }
}

// --- Comparison --------------------------------------------------------------

const MAX_PER_BUCKET = 6

/**
 * Compare a learner's prediction against a section. Pure and deterministic; the
 * result is ephemeral UI metadata, never persisted as-is (a future server pass
 * can populate the same shape). Buckets are capped so the panel stays glanceable.
 */
export function comparePrediction(
  section: ArticleSectionV2,
  predictionText: string,
): PredictionComparison {
  const prediction = predictionText.trim()
  const blocks = orderedBlocks(section)
  const articleText = blocks.map(blockPlainText).join('\n')
  const ideas = expectedIdeas(section)

  // matched / missing: which expected ideas did the learner mention?
  const matched: string[] = []
  const missing: string[] = []
  for (const idea of ideas) {
    if (prediction && mentions(prediction, idea)) matched.push(idea)
    else missing.push(idea)
  }

  // incorrect assumptions: salient words the learner asserted that appear
  // nowhere in the section. Framed gently by the UI ("not addressed here").
  const incorrect: string[] = []
  const incorrectSeen = new Set<string>()
  for (const token of predictionTokens(prediction)) {
    if (mentions(articleText, token)) continue
    // Skip tokens already explained by a matched idea (substring of a phrase).
    if (matched.some((idea) => idea.toLowerCase().includes(token))) continue
    if (incorrectSeen.has(token)) continue
    incorrectSeen.add(token)
    incorrect.push(token)
  }

  // surprising additions: specifics the article highlights that the learner
  // didn't predict — emphasised terms outside the key-term set, plus the
  // worked examples the overview normally folds away.
  const surprising: string[] = []
  const surprisingSeen = new Set<string>()
  const known = new Set(ideas.map((i) => i.toLowerCase()))
  const addSurprising = (label: string) => {
    const key = label.toLowerCase()
    if (surprisingSeen.has(key)) return
    surprisingSeen.add(key)
    surprising.push(label)
  }
  for (const block of blocks) {
    for (const term of emphasisedTerms(block)) {
      const key = term.toLowerCase()
      if (known.has(key)) continue
      if (prediction && mentions(prediction, term)) continue
      addSurprising(term)
    }
    const example = exampleLabel(block)
    if (example) addSurprising(example)
  }

  return {
    matched: matched.slice(0, MAX_PER_BUCKET),
    missing: missing.slice(0, MAX_PER_BUCKET),
    incorrect: incorrect.slice(0, MAX_PER_BUCKET),
    surprising: surprising.slice(0, MAX_PER_BUCKET),
  }
}

/**
 * A neutral one-line orientation shown alongside the prompt — it situates the
 * section (position + how many key terms are visible) WITHOUT revealing the
 * prose, so the learner still has to bring their own model. Returns undefined
 * when there's nothing non-spoiling to say.
 */
export function predictOrientation(
  section: ArticleSectionV2,
  index: number,
  total: number,
): string | undefined {
  const termCount = sectionKeyTerms(section).length
  const position = `Section ${index} of ${total}`
  if (termCount === 0) return position
  return `${position} · ${termCount} key term${termCount === 1 ? '' : 's'} in view`
}
