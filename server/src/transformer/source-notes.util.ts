import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleSourceNoteItem,
  ArticleSourceNotes,
} from './transformer.types'

/**
 * Deterministic source-notes builder (DET-350). PURE, NO LLM — so it can never
 * hallucinate. It sorts the source blocks' apparatus (citations, links, removed
 * navigation/footer, low-value material) into the five `sourceNotes` buckets so
 * the renderer keeps them OUT of the article body by default:
 *
 *  - CITATION blocks → `bibliography` (the source list), or `references` when the
 *    text looks like a formatted reference entry (a "[1]"/"1." marker, a "(2023)"
 *    year, "doi:", or "et al").
 *  - NAVIGATION_NOISE / FOOTER blocks → `removedNavigation`.
 *  - ADVERTISEMENT / SIDEBAR / DUPLICATE blocks, or any other `removable` noise →
 *    `externalLinks` when they carry a URL, otherwise `lowImportance`.
 *
 * Blocks that are real body content (kept, non-apparatus) are LEFT in the article;
 * this util never pulls them out. Every emitted item stays traceable to its block.
 */

/** Cap a note's text so a long removed block doesn't bloat the apparatus. */
const MAX_NOTE_CHARS = 400

/** First http(s) URL in the text, if any. */
const URL_RE = /(https?:\/\/[^\s)\]]+)/i

/** Looks like a formatted reference-list entry rather than a loose citation. */
const REFERENCE_ENTRY_RE = /^\s*\[?\d+\]?[.)]\s|\(\d{4}\)|\bdoi:|\bet al\.?/i

function makeItem(block: ClassifiedBlockInput): ArticleSourceNoteItem {
  const text = block.text.trim().slice(0, MAX_NOTE_CHARS)
  const url = block.text.match(URL_RE)?.[1]
  return url
    ? { text, sourceBlockIds: [block.id], url }
    : { text, sourceBlockIds: [block.id] }
}

/**
 * Build the source notes from a source's classified blocks. The blocks should be
 * the article's pinned-version blocks (same input the generators receive), in
 * source order — the buckets preserve that order.
 */
export function buildSourceNotes(
  blocks: ClassifiedBlockInput[],
): ArticleSourceNotes {
  const notes: ArticleSourceNotes = {
    references: [],
    bibliography: [],
    externalLinks: [],
    removedNavigation: [],
    lowImportance: [],
  }

  for (const block of blocks) {
    if (!block.text.trim()) continue
    const c = block.classification

    if (c === 'CITATION') {
      const item = makeItem(block)
      if (REFERENCE_ENTRY_RE.test(block.text)) notes.references.push(item)
      else notes.bibliography.push(item)
      continue
    }

    if (c === 'NAVIGATION_NOISE' || c === 'FOOTER') {
      notes.removedNavigation.push(makeItem(block))
      continue
    }

    const lowValue =
      c === 'ADVERTISEMENT' ||
      c === 'SIDEBAR' ||
      c === 'DUPLICATE' ||
      block.removable
    if (lowValue) {
      const item = makeItem(block)
      if (item.url) notes.externalLinks.push(item)
      else notes.lowImportance.push(item)
    }
    // Otherwise the block is real body content — leave it in the article.
  }

  return notes
}
