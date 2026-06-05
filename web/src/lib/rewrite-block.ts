import { type ArticleBlockV2, blockPlainText } from './article-v2'

/**
 * Rewrite-the-Block Mode (DET-285) — pure, render-time logic.
 *
 * Rewrite Mode is the core active-recall mode for generated articles: after
 * reading a block, the learner reconstructs it in their own words while the
 * source block is blurred, then submits the rewrite for later comparison. This
 * module holds the deterministic, backend-free helpers behind that flow —
 * which blocks can be rewritten, how to label them, how to snapshot the source
 * verbatim, and the shape of the per-rewrite analytics.
 *
 * Coordination rules (DET-278 + DET-285 non-goals):
 *  - Verbatim storage: the learner's rewrite is stored exactly as written
 *    (`user_answer`), and the source block is snapshotted verbatim
 *    (`source_block_snapshot`) so a later Compare & Repair pass (DET-286) can
 *    diff the two against the exact version they reconstructed.
 *  - No permanent knowledge: nothing here mints a Concept Library entry or a
 *    scheduled review prompt. A rewrite is user activity, not validated meaning,
 *    until a downstream mode approves it (DET-278 §4).
 *  - Not a grader: we never score writing style or punish shorter wording
 *    (DET-285 non-goals). The only metric is word count, surfaced as neutral
 *    context — never as a pass/fail.
 *  - Source-grounded provenance: a fresh rewrite is `user_authored_unsourced`
 *    (DET-278 §5); it is the source comparison, not this mode, that can promote
 *    it to source-supported.
 */

/** The instruction shown above the rewrite editor, stored on the start event. */
export const REWRITE_PROMPT =
  'Reconstruct this block in your own words, from memory.'

/**
 * The block types Rewrite Mode operates on. Per the AC, Rewrite Mode works with
 * paragraph, list, quote, code, and callout blocks — the text-bearing blocks a
 * learner can meaningfully reconstruct. Structural/media blocks (heading,
 * divider, table, image) are not rewrite targets.
 */
export type RewritableBlock = Extract<
  ArticleBlockV2,
  { type: 'paragraph' | 'list' | 'quote' | 'code' | 'callout' }
>

const REWRITABLE_TYPES: ReadonlySet<ArticleBlockV2['type']> = new Set([
  'paragraph',
  'list',
  'quote',
  'code',
  'callout',
])

/** Whether a block can be reconstructed in Rewrite Mode. */
export function isRewritableBlock(
  block: ArticleBlockV2,
): block is RewritableBlock {
  return REWRITABLE_TYPES.has(block.type)
}

/** The rewritable blocks of a list, preserving order. */
export function rewritableBlocks(blocks: ArticleBlockV2[]): RewritableBlock[] {
  return blocks.filter(isRewritableBlock)
}

/**
 * A short human noun for the block being reconstructed ("paragraph", "list",
 * "callout"…). Callouts surface their variant so the learner knows what kind of
 * aside they're rebuilding.
 */
export function rewriteBlockNoun(block: RewritableBlock): string {
  switch (block.type) {
    case 'paragraph':
      return 'paragraph'
    case 'list':
      return block.content.ordered ? 'ordered list' : 'list'
    case 'quote':
      return 'quote'
    case 'code':
      return block.content.language
        ? `${block.content.language} code block`
        : 'code block'
    case 'callout':
      return block.content.variant ?? 'callout'
  }
}

/**
 * The verbatim source snapshot stored on rewrite events (`source_block_snapshot`).
 * It captures the exact text the learner reconstructed from, pinned to the block
 * version, so Compare & Repair can diff against the right target later.
 */
export function sourceBlockSnapshot(block: RewritableBlock): string {
  return blockPlainText(block)
}

/** Word count of a free-text rewrite (neutral context, never a grade). */
export function rewriteWordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Per-rewrite analytics captured for learning (DET-285 data requirements). These
 * are activity metrics, not a score: `peek_count` and `time_before_first_peek_ms`
 * describe how much the learner leaned on the source; `editor_focus_duration_ms`
 * how long they spent reconstructing.
 */
export interface RewriteMetrics {
  /** How many times the learner explicitly peeked at the blurred source. */
  peek_count: number
  /** Total time the rewrite editor held focus, in milliseconds. */
  editor_focus_duration_ms: number
  /**
   * Time from first editor focus to the first peek, in milliseconds. Null when
   * the learner never peeked — a fully unaided reconstruction.
   */
  time_before_first_peek_ms: number | null
  /** Word count of the submitted rewrite. */
  word_count: number
}

/** A neutral one-line orientation for a rewrite card — no spoiler, no grade. */
export function rewriteOrientation(
  block: RewritableBlock,
  index: number,
  total: number,
): string {
  const noun = rewriteBlockNoun(block)
  const position = `Block ${index} of ${total}`
  return `${position} · reconstruct this ${noun} from memory`
}
