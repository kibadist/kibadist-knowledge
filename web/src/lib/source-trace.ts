import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
  FidelityFinding,
  FidelityReport,
  FidelityRisk,
  LearningLayer,
  Severity,
  TransformationType,
  TransformerBlockView,
} from './api'
import { blockClassLabel, blockLocationLine } from './transformer-format'

/**
 * Source-trace model for the provenance inspection UI (DET-358).
 *
 * The v3 reader (the `MagazineArticle` Compendium render) presents an Article
 * JSON v2 that has lost the per-fragment transformation metadata at the
 * `transformerArticleToV2` boundary. This module rebuilds a *traceability index*
 * directly from the RICH transformer payload the `/read` workspace already
 * fetches — the wire `ArticleJsonV2` (per-block `sourceBlockIds` +
 * `transformationType` + `fidelityRisk`), the pinned source blocks, the fidelity
 * report and the AI learning layer — so every generated paragraph, callout,
 * table, claim, concept (candidate), retrieval prompt and quality warning can be
 * traced back to the source blocks it derives from.
 *
 * The index is keyed by the SAME stable ids the renderer puts on the DOM
 * (`block.block_id`, taken verbatim from the transformer block id), so a rendered
 * block can look up its trace by id with no extra plumbing.
 *
 * Everything here is pure (no React, no network) and unit-tested against both a
 * transcript-shaped and a structured-document-shaped fixture.
 */

/**
 * Derived qualitative confidence that a generated fragment faithfully reflects
 * its source. DERIVED in code from the fidelity risk, the transformation type,
 * and whether any source span actually resolves — the pipeline does not emit a
 * model confidence, so we surface a transparent, deterministic proxy rather than
 * inventing a number. An unsupported fragment is always 'low'.
 */
export type TraceConfidence = 'high' | 'medium' | 'low'

/** A source block resolved for display inside a trace, in ORIGINAL source order. */
export interface TraceSourceBlock {
  id: string
  /** Original source text — the block preview shown in the drawer. */
  text: string
  /** Position in the source (drives original-order rendering). */
  orderIndex: number
  blockType: string
  classification: string | null
  /** A human classification label ("Definition", "Evidence"…), when classified. */
  classificationLabel: string | null
  /** Page / char-range location line, when known. */
  location: string | null
}

/** What kind of generated artifact a trace describes (drives the eyebrow label). */
export type TraceKind =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'pullQuote'
  | 'table'
  | 'code'
  | 'callout'
  | 'figureAnchor'
  | 'claim'
  | 'concept'
  | 'conceptCandidate'
  | 'retrievalPrompt'
  | 'qualityWarning'

/** A single inspectable source trace — the unit the drawer renders. */
export interface SourceTrace {
  /** Stable identity for React keys + drawer open-state. */
  id: string
  kind: TraceKind
  /** Short human label for the eyebrow ("Paragraph", "Claim", "Prompt"…). */
  label: string
  /** The generated article text being audited. */
  generatedText: string
  /** Claimed source block ids, verbatim from the artifact (kept for debug mode). */
  sourceBlockIds: string[]
  /** Resolved source blocks, sorted into ORIGINAL source order. */
  sourceBlocks: TraceSourceBlock[]
  /** Ids claimed but not resolvable against the pinned source version. */
  missingBlockIds: string[]
  transformationType?: TransformationType
  fidelityRisk?: FidelityRisk
  confidence: TraceConfidence
  /**
   * True when the fragment has NO resolvable source block — a broken/empty
   * traceability link. Renders the loud "unsupported" warning fallback.
   */
  unsupported: boolean
  /** Severity of a quality warning (fidelity finding). */
  severity?: Severity
  /** The article ref a quality warning points at (#section / paragraph id). */
  articleRef?: string
  /** Article section id this trace belongs to (concept candidates). */
  sectionId?: string
  /** Resolved section heading for display, when known. */
  sectionHeading?: string
}

/** The whole traceability index for one article. */
export interface SourceTraceIndex {
  /** Source blocks keyed by id (resolved, with original order + location). */
  blocksById: Map<string, TraceSourceBlock>
  /** Per article-block traces keyed by the rendered `block_id`. */
  byBlockId: Map<string, SourceTrace>
  /** Source-grounded claims (the reading-aids highlights). */
  claims: SourceTrace[]
  /** AI-extracted concept cards. */
  concepts: SourceTrace[]
  /** Per-section concept candidates (carry their article section id). */
  conceptCandidates: SourceTrace[]
  /** Retrieval prompts (their source blocks are the expected-answer source). */
  retrievalPrompts: SourceTrace[]
  /** Fidelity findings surfaced as quality warnings. */
  qualityWarnings: SourceTrace[]
}

export interface BuildSourceTraceIndexArgs {
  article: ArticleJsonV2 | null
  /** Source blocks pinned to the article's blocksVersion. */
  blocks: TransformerBlockView[]
  fidelityReport?: FidelityReport | null
  learningLayer?: LearningLayer | null
}

const TRACE_KIND_LABEL: Record<TraceKind, string> = {
  paragraph: 'Paragraph',
  list: 'List',
  quote: 'Quote',
  pullQuote: 'Pull-quote',
  table: 'Table',
  code: 'Code',
  callout: 'Callout',
  figureAnchor: 'Figure',
  claim: 'Claim',
  concept: 'Concept',
  conceptCandidate: 'Concept candidate',
  retrievalPrompt: 'Retrieval prompt',
  qualityWarning: 'Quality warning',
}

export function traceKindLabel(kind: TraceKind): string {
  return TRACE_KIND_LABEL[kind]
}

/** Neutral human label for a derived confidence. */
export function confidenceLabel(confidence: TraceConfidence): string {
  switch (confidence) {
    case 'high':
      return 'High confidence'
    case 'medium':
      return 'Medium confidence'
    case 'low':
      return 'Low confidence'
  }
}

/** Chip tone class for a confidence (reuses the `.kbapp` chip palette). */
export function confidenceChip(confidence: TraceConfidence): string {
  switch (confidence) {
    case 'high':
      return 'chip-cleared'
    case 'medium':
      return 'chip-pending'
    case 'low':
      return 'chip-contested'
  }
}

// A fidelity finding's severity maps 1:1 onto the fidelity-risk vocabulary —
// both are low/medium/high — so a quality warning reuses the same risk chips.
function severityToRisk(severity: Severity): FidelityRisk {
  return severity
}

/**
 * Derive a transparent confidence from the signals we actually have. The
 * pipeline never reports a model confidence, so this is a deterministic proxy:
 *  - no resolvable source  → low (unsupported)
 *  - high fidelity risk    → low
 *  - medium fidelity risk  → medium
 *  - low risk + a near-verbatim transformation → high
 *  - low risk + a heavier reshape (reword / split / merge) → medium
 */
export function deriveConfidence(args: {
  fidelityRisk?: FidelityRisk
  transformationType?: TransformationType
  hasSource: boolean
}): TraceConfidence {
  if (!args.hasSource) return 'low'
  if (args.fidelityRisk === 'high') return 'low'
  if (args.fidelityRisk === 'medium') return 'medium'
  // Low (or unknown) risk: lean on how much the text was changed.
  switch (args.transformationType) {
    case 'verbatim':
    case 'formatting_only':
    case 'grammar_cleanup':
      return 'high'
    case undefined:
      // No transformation metadata (claims, concepts, prompts): a resolved
      // source at low risk is a solid-but-not-verbatim link.
      return 'medium'
    default:
      return 'medium'
  }
}

/** Resolve claimed ids → source blocks in ORIGINAL order, plus the unresolved ids. */
function resolveBlocks(
  ids: string[],
  blocksById: Map<string, TraceSourceBlock>,
): { resolved: TraceSourceBlock[]; missing: string[] } {
  const resolved: TraceSourceBlock[] = []
  const missing: string[] = []
  for (const id of ids) {
    const block = blocksById.get(id)
    if (block) resolved.push(block)
    else missing.push(id)
  }
  resolved.sort((a, b) => a.orderIndex - b.orderIndex)
  return { resolved, missing }
}

/** Flatten one Article-JSON-v2 block to the plain text the drawer audits. */
function blockGeneratedText(block: ArticleBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'pullQuote':
      return block.text
    case 'quote':
      return block.attribution
        ? `“${block.text}” — ${block.attribution}`
        : `“${block.text}”`
    case 'list':
      return block.items.join('\n')
    case 'table':
      return [
        block.caption,
        ...(block.header ? [block.header.join(' | ')] : []),
        ...block.rows.map((r) => r.join(' | ')),
      ]
        .filter(Boolean)
        .join('\n')
    case 'code':
      return block.text
    case 'callout':
      return block.title ? `${block.title}: ${block.text}` : block.text
    case 'figureAnchor':
      return block.caption ?? ''
  }
}

/** A block's TraceKind is its v2 type — both vocabularies line up by name. */
function blockTraceKind(type: ArticleBlock['type']): TraceKind {
  return type
}

/** Build the resolved source-block map keyed by id (and carrying source order). */
function buildBlocksById(
  blocks: TransformerBlockView[],
): Map<string, TraceSourceBlock> {
  const map = new Map<string, TraceSourceBlock>()
  for (const b of blocks) {
    map.set(b.id, {
      id: b.id,
      text: b.text,
      orderIndex: b.orderIndex,
      blockType: b.blockType,
      classification: b.classification,
      classificationLabel: b.classification
        ? blockClassLabel(b.classification)
        : null,
      location: blockLocationLine(b),
    })
  }
  return map
}

/** Flatten sections + subsections into an id → heading map (candidate labels). */
function sectionHeadings(sections: ArticleSectionV2[]): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (s: ArticleSectionV2) => {
    map.set(s.id, s.heading)
    for (const sub of s.subsections ?? []) walk(sub)
  }
  for (const s of sections) walk(s)
  return map
}

/** Assemble a trace from already-resolved parts (shared by every artifact kind). */
function makeTrace(args: {
  id: string
  kind: TraceKind
  generatedText: string
  sourceBlockIds: string[]
  blocksById: Map<string, TraceSourceBlock>
  transformationType?: TransformationType
  fidelityRisk?: FidelityRisk
  severity?: Severity
  articleRef?: string
  sectionId?: string
  sectionHeading?: string
}): SourceTrace {
  const { resolved, missing } = resolveBlocks(
    args.sourceBlockIds,
    args.blocksById,
  )
  const hasSource = resolved.length > 0
  return {
    id: args.id,
    kind: args.kind,
    label: TRACE_KIND_LABEL[args.kind],
    generatedText: args.generatedText,
    sourceBlockIds: args.sourceBlockIds,
    sourceBlocks: resolved,
    missingBlockIds: missing,
    transformationType: args.transformationType,
    fidelityRisk: args.fidelityRisk,
    confidence: deriveConfidence({
      fidelityRisk: args.fidelityRisk,
      transformationType: args.transformationType,
      hasSource,
    }),
    unsupported: !hasSource,
    severity: args.severity,
    articleRef: args.articleRef,
    sectionId: args.sectionId,
    sectionHeading: args.sectionHeading,
  }
}

// The fidelity-report finding groups, in the order they surface as warnings, with
// a short human label for each. Drives the quality-warnings list (DET-358).
const FIDELITY_GROUPS: { key: keyof FidelityReport; label: string }[] = [
  { key: 'addedInformation', label: 'Added information' },
  { key: 'lostInformation', label: 'Lost information' },
  { key: 'meaningChanges', label: 'Meaning change' },
  { key: 'unsupportedHeadings', label: 'Unsupported heading' },
  { key: 'missingCaveats', label: 'Missing caveat' },
  { key: 'unsupportedExamples', label: 'Unsupported example' },
  { key: 'emphasisChanges', label: 'Emphasis change' },
  { key: 'structuralFindings', label: 'Structural finding' },
]

/** Human label for a fidelity finding group key (for the warning eyebrow). */
export function fidelityGroupLabel(key: keyof FidelityReport): string {
  return FIDELITY_GROUPS.find((g) => g.key === key)?.label ?? 'Finding'
}

/**
 * Build the full traceability index for the v3 reader. Tolerant of missing
 * pieces: a null article yields an empty index; absent fidelity / learning
 * layers simply produce empty warning / concept lists. Block-level traces are
 * keyed by the rendered `block_id` so the reader can look one up by id.
 */
export function buildSourceTraceIndex({
  article,
  blocks,
  fidelityReport,
  learningLayer,
}: BuildSourceTraceIndexArgs): SourceTraceIndex {
  const blocksById = buildBlocksById(blocks)
  const byBlockId = new Map<string, SourceTrace>()
  const claims: SourceTrace[] = []
  const concepts: SourceTrace[] = []
  const conceptCandidates: SourceTrace[] = []
  const retrievalPrompts: SourceTrace[] = []
  const qualityWarnings: SourceTrace[] = []

  if (!article) {
    return {
      blocksById,
      byBlockId,
      claims,
      concepts,
      conceptCandidates,
      retrievalPrompts,
      qualityWarnings,
    }
  }

  const headings = sectionHeadings(article.sections)

  // --- Abstract paragraphs (rendered as the full-width lede) ---
  for (const p of article.abstract) {
    byBlockId.set(
      p.id,
      makeTrace({
        id: p.id,
        kind: 'paragraph',
        generatedText: p.text,
        sourceBlockIds: p.sourceBlockIds,
        blocksById,
        transformationType: p.transformationType,
        fidelityRisk: p.fidelityRisk,
      }),
    )
  }

  // --- Every body block (paragraph / list / quote / table / code / callout…) ---
  const walkSection = (section: ArticleSectionV2) => {
    for (const block of section.blocks) {
      byBlockId.set(
        block.id,
        makeTrace({
          id: block.id,
          kind: blockTraceKind(block.type),
          generatedText: blockGeneratedText(block),
          sourceBlockIds: block.sourceBlockIds,
          blocksById,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
          sectionId: section.id,
          sectionHeading: section.heading,
        }),
      )
    }
    for (const sub of section.subsections ?? []) walkSection(sub)
  }
  for (const section of article.sections) walkSection(section)

  // --- Claims: the source-grounded reading-aids highlights ---
  const highlights = article.readingAids?.highlights ?? []
  highlights.forEach((h, i) => {
    claims.push(
      makeTrace({
        id: `claim-${i}`,
        kind: 'claim',
        generatedText: h.text,
        sourceBlockIds: h.sourceBlockIds,
        blocksById,
      }),
    )
  })

  // --- Concepts + concept candidates + retrieval prompts (AI learning layer) ---
  for (const c of learningLayer?.concepts ?? []) {
    concepts.push(
      makeTrace({
        id: c.id,
        kind: 'concept',
        generatedText: `${c.label} — ${c.definition}`,
        sourceBlockIds: c.sourceBlockIds,
        blocksById,
      }),
    )
  }
  for (const c of learningLayer?.conceptCandidates ?? []) {
    conceptCandidates.push(
      makeTrace({
        id: c.id,
        kind: 'conceptCandidate',
        generatedText: `${c.label} — ${c.definition}`,
        sourceBlockIds: c.sourceBlockIds,
        blocksById,
        sectionId: c.sectionId,
        sectionHeading: headings.get(c.sectionId),
      }),
    )
  }
  for (const p of learningLayer?.retrievalPrompts ?? []) {
    retrievalPrompts.push(
      makeTrace({
        id: p.id,
        kind: 'retrievalPrompt',
        generatedText: p.prompt,
        sourceBlockIds: p.sourceBlockIds,
        blocksById,
      }),
    )
  }

  // --- Quality warnings: every fidelity finding, across its groups ---
  if (fidelityReport) {
    for (const group of FIDELITY_GROUPS) {
      const findings = fidelityReport[group.key]
      if (!Array.isArray(findings)) continue
      ;(findings as FidelityFinding[]).forEach((f, i) => {
        qualityWarnings.push(
          makeTrace({
            id: `warn-${group.key}-${i}`,
            kind: 'qualityWarning',
            generatedText: `${group.label}: ${f.description}`,
            sourceBlockIds: f.sourceBlockIds ?? [],
            blocksById,
            fidelityRisk: severityToRisk(f.severity),
            severity: f.severity,
            articleRef: f.articleRef,
          }),
        )
      })
    }
  }

  return {
    blocksById,
    byBlockId,
    claims,
    concepts,
    conceptCandidates,
    retrievalPrompts,
    qualityWarnings,
  }
}

/** True when an index carries any appendix-level provenance to surface. */
export function hasProvenanceContent(index: SourceTraceIndex): boolean {
  return (
    index.claims.length > 0 ||
    index.concepts.length > 0 ||
    index.conceptCandidates.length > 0 ||
    index.retrievalPrompts.length > 0 ||
    index.qualityWarnings.length > 0
  )
}
