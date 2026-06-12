import type { SourceKind } from './v3.types'

/**
 * Source-kind detection (DET-343, pipeline stage "Source diagnosis"). Pure +
 * deterministic — NO LLM. The kind drives article shape, the coverage threshold
 * the quality gate enforces, and the rewrite prompt, so it must be reproducible
 * and inspectable rather than a model guess.
 *
 * The two PRD failure cases anchor the heuristics: a Udemy `transcript` (spoken,
 * filler-heavy, no headings) and a `structured_article` (headings + lists + mixed
 * blocks). We score each candidate kind from structural + lexical signals and pick
 * the strongest; ties and weak signals fall back to `mixed` (the conservative
 * default — the gate treats `mixed`/`structured_article` with the lower 70% floor).
 */

/** The minimal block shape detection consumes (a loaded source block). */
export interface DiagnosisBlock {
  /** The structural block type (HEADING/PARAGRAPH/LIST/QUOTE/TABLE/CODE/…). */
  blockType: string
  text: string
}

/** Spoken-language tells that almost never survive into edited prose. */
const FILLER_PATTERNS: RegExp[] = [
  /\b(um+|uh+|er+|hmm+)\b/i,
  /\byou know\b/i,
  /\bi mean\b/i,
  /\bkind of\b/i,
  /\bsort of\b/i,
  /\bgonna\b/i,
  /\bwanna\b/i,
  /\bgotta\b/i,
  /\bokay so\b/i,
  /\ball right\b/i,
  /\blet's (go|say|take|look)\b/i,
  /\bin this (video|lesson|lecture|course)\b/i,
  /\bright\?\s*$/i,
]

/**
 * Definitional/reference tells (encyclopedic or API/spec material). Deliberately
 * EXPLICIT phrasing only — a bare copula opener ("The weather was …") is narrative,
 * not definitional, so we do not treat it as a signal (it would misclassify prose).
 */
const DEFINITIONAL_PATTERNS: RegExp[] = [
  /\bis defined as\b/i,
  /\brefers to\b/i,
  /\bis a (type|kind|form|method|technique|pattern) of\b/i,
  /\b(returns|parameter|argument|deprecated|syntax|signature)\b/i,
]

/** Count blocks whose text matches at least one of the given patterns. */
function countMatching(blocks: DiagnosisBlock[], patterns: RegExp[]): number {
  return blocks.filter((b) => patterns.some((p) => p.test(b.text))).length
}

/**
 * The full diagnosis: the chosen kind plus the raw signals it was chosen from, so
 * the pipeline can persist/inspect WHY a kind was picked (the gate and the UI both
 * benefit from the reasoning being legible, not a bare label).
 */
export interface SourceDiagnosis {
  kind: SourceKind
  headingRatio: number
  fillerBlockRatio: number
  definitionalBlockRatio: number
  listOrTableRatio: number
  /** A short, human-readable justification of the pick. */
  reason: string
}

/**
 * Diagnose a source from its blocks. Empty input is `mixed` (nothing to ground a
 * stronger guess). The ratios are over CONTENT blocks (headings excluded from the
 * denominator for lexical ratios so a heading-free transcript isn't penalised).
 */
export function diagnoseSource(blocks: DiagnosisBlock[]): SourceDiagnosis {
  const total = blocks.length
  if (total === 0) {
    return {
      kind: 'mixed',
      headingRatio: 0,
      fillerBlockRatio: 0,
      definitionalBlockRatio: 0,
      listOrTableRatio: 0,
      reason: 'no blocks to diagnose',
    }
  }

  const headings = blocks.filter((b) => b.blockType === 'HEADING')
  const listsOrTables = blocks.filter(
    (b) => b.blockType === 'LIST' || b.blockType === 'TABLE',
  )
  const contentBlocks = blocks.filter((b) => b.blockType !== 'HEADING')
  const contentTotal = Math.max(contentBlocks.length, 1)

  const headingRatio = headings.length / total
  const fillerBlockRatio =
    countMatching(contentBlocks, FILLER_PATTERNS) / contentTotal
  const definitionalBlockRatio =
    countMatching(contentBlocks, DEFINITIONAL_PATTERNS) / contentTotal
  const listOrTableRatio = listsOrTables.length / total

  // Structural signal: spoken material runs as long unbroken paragraph blocks.
  const avgBlockChars =
    contentBlocks.reduce((sum, b) => sum + b.text.length, 0) / contentTotal

  // Score each kind from independent, additive signals (0..~1 each). The winner is
  // the max; a weak winner (< MIN_CONFIDENCE) falls back to `mixed`.
  // Spoken material is driven by FILLER; the absence of headings and long unbroken
  // blocks are only weak corroborating hints (each below MIN_CONFIDENCE on its own,
  // so a short filler-free snippet stays `mixed` rather than guessing transcript).
  const transcriptScore =
    fillerBlockRatio * 1.5 +
    (headingRatio < 0.04 ? 0.3 : 0) +
    (avgBlockChars > 400 ? 0.3 : 0)

  const structuredScore =
    (headingRatio >= 0.08 ? 0.7 : headingRatio * 4) +
    listOrTableRatio * 1.0 +
    (avgBlockChars <= 700 ? 0.2 : 0)

  const referenceScore =
    definitionalBlockRatio * 1.5 +
    (headings.length > 0 && headings.length / contentTotal > 0.5 ? 0.4 : 0)

  const scored: { kind: SourceKind; score: number }[] = [
    { kind: 'transcript', score: transcriptScore },
    { kind: 'structured_article', score: structuredScore },
    { kind: 'reference', score: referenceScore },
  ]
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]

  const MIN_CONFIDENCE = 0.5
  const kind: SourceKind = top.score < MIN_CONFIDENCE ? 'mixed' : top.kind

  const reason =
    kind === 'mixed'
      ? `no dominant signal (top ${top.kind} scored ${top.score.toFixed(2)} < ${MIN_CONFIDENCE})`
      : `${kind} (score ${top.score.toFixed(2)}; headings ${(headingRatio * 100) | 0}%, filler ${(fillerBlockRatio * 100) | 0}%, definitional ${(definitionalBlockRatio * 100) | 0}%)`

  return {
    kind,
    headingRatio,
    fillerBlockRatio,
    definitionalBlockRatio,
    listOrTableRatio,
    reason,
  }
}
