/**
 * Structured source contract (DET-210).
 *
 * A captured source is extracted into an ordered list of typed blocks BEFORE
 * the Reader renders it (DET-209), so document hierarchy — headings, lists,
 * quotes, code, links, images, tables — survives instead of being flattened to
 * a run-on string. The structured form is the *correct* representation; the
 * Reader makes it *beautiful*.
 *
 * Invariants this contract must hold:
 * - Every block has a STABLE id (see block-id.util.ts). DET-208 Reference Q&A
 *   cites block ids, and a future DET-190 Compression uses blocks as context —
 *   so ids must survive re-extraction of unchanged content, not be array
 *   indices that shift when extraction improves.
 * - This is SOURCE / reference material, never earned knowledge. Extraction is
 *   provenance-preserving and meaning-neutral: no summarizing, tagging, or
 *   linking (the DET-187 capture invariant).
 * - The raw flattened text is kept separately (Concept.sourceText) for
 *   debugging/provenance and as a search/fallback surface.
 *
 * NOTE: This type is mirrored by hand in web/src/lib/api.ts (the repo's
 * established pattern for server↔web DTOs). Keep the two in sync.
 */

/** Inline emphasis on a run of text. Kept minimal and presentational. */
export type InlineMark = 'bold' | 'italic' | 'code' | 'strikethrough'

/**
 * A contiguous run of inline text with optional marks and an optional link.
 * A run with an `href` is a link; nested links are flattened to a single run.
 */
export interface InlineRun {
  text: string
  marks?: InlineMark[]
  href?: string
}

export interface HeadingBlock {
  id: string
  type: 'heading'
  /** 1–6 as found; the Reader styles 4–6 like a level-3 heading. */
  level: number
  text: string
}

export interface ParagraphBlock {
  id: string
  type: 'paragraph'
  runs: InlineRun[]
}

export interface QuoteBlock {
  id: string
  type: 'quote'
  runs: InlineRun[]
}

export interface ListBlock {
  id: string
  type: 'list'
  ordered: boolean
  /** Each item is its own array of inline runs. MVP keeps lists flat. */
  items: InlineRun[][]
}

export interface CodeBlock {
  id: string
  type: 'code'
  text: string
  language?: string
}

export interface ImageBlock {
  id: string
  type: 'image'
  src: string
  alt?: string
  caption?: string
}

export interface TableBlock {
  id: string
  type: 'table'
  /** Whether the first row is a header row. */
  header: boolean
  /** Row-major plain-text cells. MVP does not model inline marks in cells. */
  rows: string[][]
}

export type SourceBlock =
  | HeadingBlock
  | ParagraphBlock
  | QuoteBlock
  | ListBlock
  | CodeBlock
  | ImageBlock
  | TableBlock

export type SourceBlockType = SourceBlock['type']

/** Which extractor produced a document — provenance for debugging/versioning. */
export type SourceExtractor =
  | 'html-heuristic@1'
  | 'pdf-paragraph@1'
  | 'text-markdown@1'
  | 'readability@1'
  | 'mediawiki@1'

export interface SourceDocument {
  /** Schema version, so stored documents can be migrated if the shape evolves. */
  version: 1
  /** Document title, if the source carried one distinct from the block flow. */
  title?: string
  /**
   * Standfirst / subtitle and author. Best-effort and extractor-dependent:
   * currently only the `readability@1` path populates these; other extractors
   * (`html-heuristic@1`, `mediawiki@1`, the text/pdf paths) leave them unset.
   */
  dek?: string
  byline?: string
  canonicalUrl?: string
  blocks: SourceBlock[]
  /** Which extractor + version produced this document. */
  extractor: SourceExtractor
  /**
   * True when extraction was lossy/best-effort (e.g. PDF, where structure is
   * largely unrecoverable). The UI can note that structure may be incomplete.
   */
  degraded: boolean
}
