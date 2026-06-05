/**
 * Stable article / section / block ids (DET-278, rule #1).
 *
 * Learning events anchor to these ids forever, so the cardinal rule is: an id is
 * minted ONCE and persisted, never recalculated on render. Two failure modes the
 * contract forbids:
 *
 *   - Array indexes as identity. Reordering or inserting a section/block upstream
 *     would silently reattach a learner's saved prediction/rewrite to the wrong
 *     content. Events must point at the exact article version + a stable id.
 *   - Recomputing ids at render time from mutable content. If a block's text is
 *     lightly edited, a content-only hash would change and orphan its events.
 *
 * Approach: ids are POSITION-ANCHORED within a fixed article version. The article
 * owns its own id (a new article version => a new `article_id`). Section ids are
 * derived from the article id + the section's stable ordinal; block ids from the
 * section id + the block's stable ordinal. Because they are scoped under an
 * immutable `article_id`, the same logical position yields the same id across
 * re-renders, while a material regeneration (which mints a new `article_id`)
 * correctly yields a fresh id space — exactly what "events point at the exact
 * version" requires.
 *
 * This mirrors the content-addressed `BlockIdFactory` of DET-210 in spirit (small
 * deterministic hash, no crypto dependency) but anchors on version+position
 * rather than content, because article blocks are EDITED in place during a
 * version's life (a learner rewrites a block) where source blocks are immutable.
 */

/** FNV-1a 32-bit — same primitive as the DET-210 block-id util; no crypto dep. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function token(input: string): string {
  return fnv1a(input).toString(36)
}

/**
 * Derive a stable `section_id` for a section at `orderIndex` within the given
 * article version. Deterministic: same (articleId, orderIndex) => same id.
 */
export function makeSectionId(articleId: string, orderIndex: number): string {
  return `s_${token(`${articleId}|${orderIndex}`)}`
}

/**
 * Derive a stable `block_id` for a block at `orderIndex` within `sectionId`.
 * Deterministic: same (sectionId, orderIndex) => same id. The section id already
 * encodes the article version, so block ids are unique across an article.
 */
export function makeBlockId(sectionId: string, orderIndex: number): string {
  return `b_${token(`${sectionId}|${orderIndex}`)}`
}

/**
 * Mints the id triplet for one freshly generated article version and stamps
 * every section/block with its persisted id and `order_index`. Call this ONCE,
 * at generation time, and persist the result; never re-run it on read.
 *
 * `articleId` is supplied by the caller (the generator decides versioning — a
 * material regeneration passes a new id). Returns the same logical structure
 * with `section_id`, `block_id`, and `order_index` filled in and back-pointers
 * (`block.section_id`) made consistent.
 */
export interface RawArticleBlock {
  type: string
  content: unknown
  source_span_ids?: string[]
  generated_from_block_ids?: string[]
}

export interface RawArticleSection {
  heading: string
  blocks: RawArticleBlock[]
}

export interface StampedBlock extends RawArticleBlock {
  block_id: string
  section_id: string
  order_index: number
}

export interface StampedSection extends RawArticleSection {
  section_id: string
  order_index: number
  blocks: StampedBlock[]
}

export function stampArticleIds(
  articleId: string,
  sections: RawArticleSection[],
): StampedSection[] {
  return sections.map((section, sectionIndex) => {
    const sectionId = makeSectionId(articleId, sectionIndex)
    return {
      ...section,
      section_id: sectionId,
      order_index: sectionIndex,
      blocks: section.blocks.map((block, blockIndex) => ({
        ...block,
        block_id: makeBlockId(sectionId, blockIndex),
        section_id: sectionId,
        order_index: blockIndex,
      })),
    }
  })
}
