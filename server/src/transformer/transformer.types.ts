/**
 * Source-Preserving Article Transformer — shared JSON contracts (DET-247…259).
 *
 * FROZEN CONTRACT. This file is committed by Wave A as its first deliverable and
 * MUST NOT change without an explicit checkpoint:
 *   - Wave B builds zod schemas that satisfy these types
 *     (`z.ZodType<SourcePreservingArticle>` etc.).
 *   - Wave C mirrors THIS committed file (not the spec prose) into
 *     `web/src/lib/api.ts`.
 *   - Wave D verifies the web types structurally match this file.
 *
 * Core invariant the contract encodes: every article sentence is traceable to
 * source blocks. Every paragraph/section/term/example/caveat carries
 * `sourceBlockIds`; the fidelity + coverage reports are the audit of that.
 */

export type TransformationType =
  | 'verbatim'
  | 'grammar_cleanup'
  | 'light_reword'
  | 'paragraph_split'
  | 'paragraph_merge'
  | 'formatting_only'

export type FidelityRisk = 'low' | 'medium' | 'high'

export type Severity = 'low' | 'medium' | 'high'

export type HeadingSource = 'original' | 'light_reword' | 'inferred_from_source'

export interface ArticleParagraph {
  id: string
  text: string
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
}

export interface ArticleSection {
  id: string
  heading: string
  headingSource: HeadingSource
  sourceBlockIds: string[]
  paragraphs: ArticleParagraph[]
}

export interface SourcePreservingArticle {
  mode: 'source_preserving_article'
  title: { text: string; source: HeadingSource }
  subtitle?: { text: string; source: HeadingSource; sourceBlockIds: string[] }
  /** Source summary assembled only from source blocks. */
  abstract: ArticleParagraph[]
  sections: ArticleSection[]
  keyTerms: { term: string; sourceBlockIds: string[] }[]
  sourceExamples: { text: string; sourceBlockIds: string[] }[]
  caveats: { text: string; sourceBlockIds: string[] }[]
  /** Source outline reference. */
  originalStructure: { blockId: string; blockType: string; preview: string }[]
}

export interface FidelityFinding {
  severity: Severity
  description: string
  articleRef?: string
  sourceBlockIds?: string[]
}

export interface FidelityReport {
  fidelityScore: number
  approved: boolean
  addedInformation: FidelityFinding[]
  lostInformation: FidelityFinding[]
  meaningChanges: FidelityFinding[]
  unsupportedHeadings: FidelityFinding[]
  missingCaveats: FidelityFinding[]
  unsupportedExamples: FidelityFinding[]
}

export interface CoverageReport {
  totalBlocks: number
  coveragePercent: number
  representedBlockIds: string[]
  removedBlocks: { blockId: string; reason: string }[]
  uncertainBlockIds: string[]
  unrepresentedBlockIds: string[]
  paragraphMap: {
    paragraphId: string
    sourceBlockIds: string[]
    transformationType: TransformationType
    fidelityRisk: FidelityRisk
  }[]
}
