import type { SourceBlockType } from './source-document.types'

/**
 * Stable block ids (DET-210).
 *
 * Ids are CONTENT-ADDRESSED: a deterministic hash of the block's type and its
 * normalized text. This is deliberate — DET-208 citations and (future) DET-190
 * compression context reference block ids, so an id must point at the same
 * content even after the extractor is improved and the document re-extracted.
 * An array index would shift when a single block is added upstream and silently
 * break every downstream citation.
 *
 * Duplicate content (e.g. two identical "Note:" paragraphs) is disambiguated by
 * appending the occurrence ordinal, so ids stay unique within a document while
 * remaining stable for unchanged content.
 *
 * KNOWN LIMITATION (acceptable for MVP): ordinal disambiguation is positional
 * among identical blocks, so inserting/removing one instance of a DUPLICATED
 * block upstream renumbers the later identical ones (the 2nd "Note" becomes the
 * 3rd). A citation to a duplicated block can therefore drift across
 * re-extraction. Citations to UNIQUE blocks — the overwhelmingly common case —
 * are unaffected. Hardening (neighbor-salted hashing) would trade away the
 * cross-extractor stability this scheme is chosen for.
 */

/** FNV-1a 32-bit. No crypto dependency; collisions are vanishingly unlikely for
 *  block-sized text and harmless (worst case: two blocks share a citation
 *  anchor within one document). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash *= 16777619, kept in 32-bit space via Math.imul.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Tracks how many times a given content hash has been seen while building one
 * document, so repeated content gets distinct (still-stable) ids.
 */
export class BlockIdFactory {
  private readonly counts = new Map<string, number>()

  next(type: SourceBlockType, text: string): string {
    const base = `${type}|${normalize(text)}`
    const hash = fnv1a(base).toString(36)
    const seen = this.counts.get(hash) ?? 0
    this.counts.set(hash, seen + 1)
    // First occurrence keeps the bare hash; repeats append the ordinal.
    return seen === 0 ? `b_${hash}` : `b_${hash}_${seen}`
  }
}
