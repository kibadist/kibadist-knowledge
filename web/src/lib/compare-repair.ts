import type { SourceConfidence } from './article-learning-events'
import { type ArticleBlockV2, blockPlainText } from './article-v2'

/**
 * Compare & Repair Mode (DET-286) — pure, render-time comparison logic.
 *
 * Compare & Repair is the feedback mode that closes the active-recall loop: after
 * a learner reconstructs a block from memory (Rewrite-the-Block, DET-285) or
 * predicts a section (Predict Before Reveal, DET-282), this module diffs their
 * answer against the generated article block and turns the difference into
 * targeted, non-punitive feedback —
 *
 *   - preserved claims      (ideas they kept faithfully)
 *   - missing claims        (ideas the block makes that they dropped)
 *   - distorted claims      (ideas whose *meaning* they changed — flipped polarity)
 *   - unsupported claims    (assertions they added that the block doesn't support)
 *   - detected misconceptions (the divergences worth repairing later)
 *
 * Design rules (DET-278 coordination + DET-286 non-goals):
 *  - Structured, not just prose: the result is a typed object (DET-278 §2/§5), so
 *    `comparison_generated` events store data a downstream system can act on, not
 *    only a paragraph of feedback.
 *  - Three-layer provenance (DET-278 §5): a claim traces user answer → article
 *    block → original source span. Because Compare & Repair is the flow that
 *    *resolves* source support, a faithful answer over a source-cited block whose
 *    spans are available is promoted to `source_supported`; over a cited block
 *    whose source text isn't loaded it is `article_supported_source_unavailable`;
 *    over an uncited block it stays `user_authored_unsourced`; an answer that
 *    invents claims is `unsupported_or_invented`; a mixed picture is `needs_review`.
 *  - Distinguishes *missing* from *wrong* (AC): a dropped idea (missing) is a
 *    different bucket from a flipped idea (distorted), which is different again
 *    from an invented one (unsupported). The UI gives each its own framing.
 *  - Rewording is not invention (AC): unsupported detection keys on *new salient
 *    content* with no grounding in the block, so a faithful paraphrase that reuses
 *    the block's ideas in fresh words is never flagged as an addition.
 *  - Not a harsh grader (DET-286 non-goals): scores are computed for storage but
 *    are *optional* signals, never surfaced as a pass/fail; a shorter answer that
 *    preserves meaning is not penalised; the repair prompt asks for one improved
 *    attempt rather than assigning a mark.
 *  - No permanent knowledge (DET-278 §4): nothing here mints a concept, a note, or
 *    a scheduled review prompt. The result may *suggest* practice, but scheduling
 *    requires later validation.
 *
 * The heuristic is deliberately deterministic and client-side (lexical claim
 * matching, polarity/negation flips), mirroring how Predict Mode runs at reveal
 * time. The shape is forward-compatible with a server/AI pass: a backend could
 * later populate the very same `RewriteComparison` with richer semantics.
 */

/** Which two artefacts a comparison diffs (DET-286 data requirement). */
export type ComparisonType = 'rewrite_vs_block' | 'prediction_vs_section'

/** A divergence worth repairing later — forwarded to the misconception profile. */
export interface DetectedMisconception {
  /** What the learner appears to have asserted (their divergent wording). */
  belief: string
  /** What the block actually claims, so the repair has a target. */
  article: string
}

/**
 * The structured comparison result (DET-286 data requirements). Buckets are
 * source-grounded strings; scores are optional storage signals, never a grade.
 */
export interface RewriteComparison {
  comparison_type: ComparisonType
  /** Block ideas the learner kept faithfully. */
  preserved_claims: string[]
  /** Block ideas the learner dropped entirely. */
  missing_claims: string[]
  /** Block ideas whose meaning the learner changed (flipped polarity/negation). */
  distorted_claims: string[]
  /** Assertions the learner added that the block doesn't support (inventions). */
  unsupported_claims: string[]
  /** Divergences worth forwarding to the misconception profile later. */
  detected_misconceptions: DetectedMisconception[]
  /** Overall provenance of the learner's answer against the block (+ source). */
  source_confidence: SourceConfidence
  /** Fraction of the answer's salient words grounded in the block (0..1). */
  source_faithfulness_score?: number
  /** Fraction of the block's claims captured faithfully (0..1). */
  understanding_score?: number
  /** Whether the learner should be invited to try one improved attempt. */
  revision_requested: boolean
  /** A short, specific, non-punitive prompt for the next attempt. */
  repair_prompt: string
}

export interface CompareOptions {
  /** Whether the original source spans behind the block are available. */
  sourceAvailable?: boolean
  /** Override the comparison type label (defaults to `rewrite_vs_block`). */
  comparisonType?: ComparisonType
}

// --- Tokenisation ------------------------------------------------------------

/**
 * Function words and generic filler we never treat as a claim word. Kept small
 * and generic — the goal is to drop "the/this/and" so content-word overlap
 * measures meaning, not grammar. Mirrors Predict Mode's stoplist in spirit.
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
  'then',
  'than',
  'with',
  'without',
  'into',
  'onto',
  'from',
  'some',
  'such',
  'about',
  'which',
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
  'will',
  'would',
  'should',
  'could',
  'might',
  'may',
  'can',
  'because',
  'each',
  'every',
  'both',
  'either',
  'over',
  'under',
  'between',
  'through',
  'across',
  'after',
  'before',
  'during',
  'here',
  'only',
  'even',
  'still',
  'into',
  'out',
  'off',
  'use',
  'used',
  'using',
  'one',
  'two',
  'get',
  'gets',
  'got',
  'make',
  'makes',
  'made',
  'thing',
  'things',
  'way',
  'ways',
  'lot',
  'lots',
  'really',
  'something',
  'someone',
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

/** Significant content words as a set (case-insensitive, deduped). */
function contentWordSet(text: string): Set<string> {
  return new Set(contentWordList(text))
}

// --- Polarity (meaning-change detection) -------------------------------------

/** Negation tokens — a parity flip on a shared topic signals a meaning change. */
const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'none',
  'cannot',
  'without',
  "n't",
  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "won't",
  "can't",
  "shouldn't",
  "wouldn't",
  "couldn't",
  'nor',
  'neither',
  'nothing',
  'unlike',
  'rarely',
  'hardly',
])

/** Antonym pairs — an opposite on a shared topic signals a meaning change. */
const ANTONYM_SEEDS: Array<[string, string]> = [
  ['increase', 'decrease'],
  ['increases', 'decreases'],
  ['increasing', 'decreasing'],
  ['increased', 'decreased'],
  ['more', 'less'],
  ['most', 'least'],
  ['many', 'few'],
  ['faster', 'slower'],
  ['fast', 'slow'],
  ['quick', 'slow'],
  ['longer', 'shorter'],
  ['long', 'short'],
  ['large', 'small'],
  ['higher', 'lower'],
  ['high', 'low'],
  ['rise', 'fall'],
  ['rises', 'falls'],
  ['expand', 'shrink'],
  ['expands', 'shrinks'],
  ['grow', 'shrink'],
  ['harder', 'easier'],
  ['hard', 'easy'],
  ['difficult', 'easy'],
  ['strengthen', 'weaken'],
  ['strengthens', 'weakens'],
  ['strong', 'weak'],
  ['better', 'worse'],
  ['best', 'worst'],
  ['good', 'bad'],
  ['always', 'never'],
  ['all', 'none'],
  ['everything', 'nothing'],
  ['positive', 'negative'],
  ['add', 'remove'],
  ['adds', 'removes'],
  ['before', 'after'],
  ['early', 'late'],
  ['begin', 'end'],
  ['enable', 'disable'],
  ['enables', 'disables'],
  ['allow', 'prevent'],
  ['allows', 'prevents'],
  ['include', 'exclude'],
  ['includes', 'excludes'],
  ['raise', 'lower'],
  ['raises', 'lowers'],
  ['wider', 'narrower'],
]

const ANTONYMS: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [a, b] of ANTONYM_SEEDS) {
    map.set(a, b)
    map.set(b, a)
  }
  return map
})()

/** How many negation tokens a text contains. */
function negationCount(text: string): number {
  let n = 0
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    if (NEGATIONS.has(raw)) n += 1
    // Catch contracted "doesn't" etc. when split keeps the apostrophe form.
    else if (raw.endsWith("n't")) n += 1
  }
  return n
}

/** All lowercased tokens of a text (for antonym lookup), deduped. */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean),
  )
}

// --- Claim segmentation ------------------------------------------------------

/** Split prose into claim-sized chunks, keeping terminal punctuation. */
function splitProse(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The claims a block asserts. Lists yield one claim per item; code yields one
 * per non-empty line; everything else is sentence-segmented. Claims with fewer
 * than two content words are dropped — they carry no meaning to compare.
 */
export function blockClaims(block: ArticleBlockV2): string[] {
  let raw: string[]
  if (block.type === 'list') {
    raw = block.content.items.map((item) =>
      item
        .map((r) => r.text)
        .join('')
        .trim(),
    )
  } else if (block.type === 'code') {
    raw = block.content.text.split(/\n+/).map((l) => l.trim())
  } else {
    raw = splitProse(blockPlainText(block))
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const claim of raw) {
    const trimmed = claim.trim()
    if (!trimmed) continue
    if (contentWordList(trimmed).length < 2) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

// --- Comparison --------------------------------------------------------------

const MAX_PER_BUCKET = 8
/** Min fraction of a block claim's words the answer must reuse to count as kept. */
const COVER_THRESHOLD = 0.4
/** Max fraction of a learner sentence grounded in the block to call it invented. */
const UNSUPPORTED_THRESHOLD = 0.34
/** Shared content words needed before two sentences are "about the same thing". */
const SHARED_TOPIC_MIN = 2

/** Whether two word-sets overlap on at least `min` members. */
function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n += 1
  return n
}

/**
 * Does the learner's sentence change the *meaning* of a block claim it clearly
 * addresses? True when they share a topic (≥2 content words) and either an
 * antonym appears across them or their negation parity differs. Conservative by
 * design: a flip must sit on shared ground, so harmless rewording never trips it.
 */
function isDistortion(claim: string, sentence: string): boolean {
  const claimWords = contentWordSet(claim)
  const sentWords = contentWordSet(sentence)
  if (sharedCount(claimWords, sentWords) < SHARED_TOPIC_MIN) return false

  const claimTokens = tokenSet(claim)
  const sentTokens = tokenSet(sentence)

  // Antonym flip: the block says X, the learner says the opposite of X.
  for (const tok of claimTokens) {
    const opposite = ANTONYMS.get(tok)
    if (opposite && sentTokens.has(opposite) && !sentTokens.has(tok)) {
      return true
    }
  }

  // Negation flip: exactly one side negates the shared topic.
  const claimNeg = negationCount(claim) % 2
  const sentNeg = negationCount(sentence) % 2
  if (claimNeg !== sentNeg) return true

  return false
}

/** First `n` words of a string, with an ellipsis when it was truncated. */
function gist(text: string, n = 11): string {
  const words = text.trim().replace(/\s+/g, ' ').split(' ')
  if (words.length <= n) return words.join(' ')
  return `${words.slice(0, n).join(' ')}…`
}

/** The repair prompt: one short, specific, non-punitive next step. */
function buildRepairPrompt(
  distorted: string[],
  missing: string[],
  unsupported: string[],
): string {
  if (distorted.length > 0) {
    return `Re-check "${gist(distorted[0])}" — your version changes what the block claims. Restate it the block's way.`
  }
  if (missing.length > 0) {
    const extra =
      missing.length > 1
        ? ` (and ${missing.length - 1} more idea${missing.length - 1 === 1 ? '' : 's'})`
        : ''
    return `Bring back the idea you dropped: "${gist(missing[0])}"${extra}.`
  }
  if (unsupported.length > 0) {
    return `You added "${gist(unsupported[0])}" — the block doesn't support it. Keep it only if you can ground it.`
  }
  return 'Strong reconstruction — your version preserves the block’s meaning. Tighten the wording if you like.'
}

/**
 * Resolve the overall provenance of the learner's answer (DET-278 §5). Compare &
 * Repair is the flow that promotes a faithful answer over a source-cited block to
 * `source_supported`; everything else degrades from there.
 */
function resolveSourceConfidence(args: {
  hasContent: boolean
  faithfulness: number
  preserved: number
  unsupported: number
  hasSourceSpans: boolean
  sourceAvailable: boolean
}): SourceConfidence {
  const {
    hasContent,
    faithfulness,
    preserved,
    unsupported,
    hasSourceSpans,
    sourceAvailable,
  } = args

  if (!hasContent) return 'needs_review'

  // Inventions dominate, or nothing was grounded → unsupported/invented.
  if (unsupported > 0 && (faithfulness < 0.5 || preserved === 0)) {
    return 'unsupported_or_invented'
  }

  const faithful = faithfulness >= 0.6 && preserved > 0
  if (faithful) {
    if (hasSourceSpans && sourceAvailable) return 'source_supported'
    if (hasSourceSpans) return 'article_supported_source_unavailable'
    return 'user_authored_unsourced'
  }

  // Some grounding but also gaps/additions, or low coverage → needs a look.
  if (unsupported > 0) return 'unsupported_or_invented'
  return 'needs_review'
}

/**
 * Compare a learner's answer against the article block it reconstructs. Pure and
 * deterministic; the result is structured feedback meant to be stored on a
 * `comparison_generated` event and shown by {@link RewriteComparison}'s panel. A
 * future server pass can populate the same shape with richer semantics.
 */
export function compareRewrite(
  block: ArticleBlockV2,
  userAnswer: string,
  options: CompareOptions = {},
): RewriteComparison {
  const comparison_type = options.comparisonType ?? 'rewrite_vs_block'
  const answer = userAnswer.trim()

  const claims = blockClaims(block)
  const corpus = contentWordSet(blockPlainText(block))
  const answerWordSet = contentWordSet(answer)
  const answerSentences = splitProse(answer)

  const preserved: string[] = []
  const missing: string[] = []
  const distorted: string[] = []
  const misconceptions: DetectedMisconception[] = []

  for (const claim of claims) {
    const claimWords = contentWordSet(claim)
    if (claimWords.size === 0) continue

    // Which learner sentences clearly address this claim (shared topic)?
    const related = answerSentences.filter(
      (s) => sharedCount(claimWords, contentWordSet(s)) >= SHARED_TOPIC_MIN,
    )

    // Meaning change wins: an addressed-but-flipped claim is distorted, not kept.
    const flipped = related.find((s) => isDistortion(claim, s))
    if (flipped) {
      distorted.push(claim)
      misconceptions.push({
        belief: gist(flipped, 16),
        article: gist(claim, 16),
      })
      continue
    }

    // Coverage: how much of the claim's vocabulary the answer reuses.
    let overlap = 0
    for (const w of claimWords) if (answerWordSet.has(w)) overlap += 1
    const coverage = overlap / claimWords.size
    if (answer && coverage >= COVER_THRESHOLD) preserved.push(claim)
    else missing.push(claim)
  }

  // Unsupported additions: substantive learner sentences with almost no grounding
  // in the block. Keying on *new salient content* keeps faithful rewording out.
  const unsupported: string[] = []
  const unsupportedSeen = new Set<string>()
  for (const sentence of answerSentences) {
    const words = contentWordList(sentence)
    if (words.length < 3) continue
    const unique = new Set(words)
    let grounded = 0
    for (const w of unique) if (corpus.has(w)) grounded += 1
    const support = grounded / unique.size
    if (support > UNSUPPORTED_THRESHOLD) continue
    const key = sentence.toLowerCase()
    if (unsupportedSeen.has(key)) continue
    unsupportedSeen.add(key)
    unsupported.push(sentence)
  }

  // Scores — computed for storage, never shown as a grade (DET-286 non-goal).
  const answerWords = contentWordList(answer)
  let groundedTotal = 0
  for (const w of answerWords) if (corpus.has(w)) groundedTotal += 1
  const source_faithfulness_score =
    answerWords.length > 0
      ? Number((groundedTotal / answerWords.length).toFixed(2))
      : undefined
  const consideredClaims = preserved.length + missing.length + distorted.length
  const understanding_score =
    consideredClaims > 0
      ? Number((preserved.length / consideredClaims).toFixed(2))
      : undefined

  const revision_requested =
    missing.length > 0 || distorted.length > 0 || unsupported.length > 0

  const source_confidence = resolveSourceConfidence({
    hasContent: answerWords.length > 0,
    faithfulness: source_faithfulness_score ?? 0,
    preserved: preserved.length,
    unsupported: unsupported.length,
    hasSourceSpans: Boolean(block.source_span_ids?.length),
    sourceAvailable: Boolean(options.sourceAvailable),
  })

  const repair_prompt = buildRepairPrompt(distorted, missing, unsupported)

  return {
    comparison_type,
    preserved_claims: preserved.slice(0, MAX_PER_BUCKET),
    missing_claims: missing.slice(0, MAX_PER_BUCKET),
    distorted_claims: distorted.slice(0, MAX_PER_BUCKET),
    unsupported_claims: unsupported.slice(0, MAX_PER_BUCKET),
    detected_misconceptions: misconceptions.slice(0, MAX_PER_BUCKET),
    source_confidence,
    source_faithfulness_score,
    understanding_score,
    revision_requested,
    repair_prompt,
  }
}

/** True when a comparison found nothing to show (e.g. an empty answer). */
export function isEmptyComparison(c: RewriteComparison): boolean {
  return (
    c.preserved_claims.length === 0 &&
    c.missing_claims.length === 0 &&
    c.distorted_claims.length === 0 &&
    c.unsupported_claims.length === 0
  )
}

/** A neutral, human label for a source-confidence state (for the UI footer). */
export const SOURCE_CONFIDENCE_LABEL: Record<SourceConfidence, string> = {
  source_supported: 'Traceable to the source',
  article_supported_source_unavailable: 'Matches the article',
  user_authored_unsourced: 'Your own wording',
  unsupported_or_invented: 'Some claims unsupported',
  needs_review: 'Needs another look',
}
