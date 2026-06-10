import { toArticleV2 } from './article-compat.util'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
  ArticleShape,
  FidelityFinding,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Deterministic STRUCTURAL fidelity checks (DET-281). Pure functions over a v2
 * article + the source block text, used by `mergeDeterministicChecks` AFTER the
 * LLM responds. None of these trust the model; every finding is computed here.
 *
 * The checks (all conservative — heuristics never auto-block unless the spec
 * says so):
 *  - {@link checkFullTraceability}: every typed block / subsection / abstract /
 *    keyTerm / sourceExample / caveat AND readingAids highlights + callout
 *    placements references non-empty, KNOWN sourceBlockIds. Missing/empty/unknown
 *    → high `structuralFindings` + a traceability violation (blocks approval).
 *  - {@link checkQuoteAttribution}: a quote whose cited source carries an
 *    attribution the article quote dropped → medium (heuristic, non-blocking).
 *  - {@link checkDuplicateRendering}: same normalized text rendered twice across
 *    blocks, or once in a block AND once in a top-level caveat/example/keyTerm →
 *    medium; a fully-duplicated CAVEAT → high (blocks). pullQuote is exempt
 *    (display emphasis is its job).
 *  - {@link checkUnsupportedHighlights}: a readingAids highlight with empty /
 *    unknown sourceBlockIds → high (blocks). (Subset of full traceability, kept
 *    explicit so the message names the reading-aid forward-compat path.)
 */

/** Source block as the structural checks consume it (id + text). */
export interface SourceBlockText {
  id: string
  text: string
}

/** The aggregate result the service merges into the report. */
export interface StructuralCheckResult {
  /** High-severity untraceable/duplicate-caveat findings (block approval). */
  structuralFindings: FidelityFinding[]
  /** Any high-severity finding above also flags a traceability violation. */
  traceabilityViolation: boolean
}

/** Lowercase, collapse whitespace, strip punctuation — for duplicate matching. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Walk every section + its subsections depth-first (reading order). */
function walkSections(
  sections: ArticleSectionV2[],
  visit: (section: ArticleSectionV2) => void,
): void {
  for (const s of sections) {
    visit(s)
    if (s.subsections) walkSections(s.subsections, visit)
  }
}

/** Every block of every section/subsection, in reading order. */
function allBlocks(article: ArticleJsonV2): ArticleBlock[] {
  const blocks: ArticleBlock[] = []
  walkSections(article.sections, (s) => {
    for (const b of s.blocks) blocks.push(b)
  })
  return blocks
}

/** The rendered text of a block, when it carries body text. */
function blockText(block: ArticleBlock): string | undefined {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
    case 'pullQuote':
    case 'code':
    case 'callout':
      return block.text
    case 'list':
      return block.items.join(' ')
    case 'table':
      return block.rows.map((r) => r.join(' ')).join(' ')
    // The LaTeX IS the equation's body text (DET-322) — comparing it keeps the
    // verbatim-preservation check meaningful for math sources.
    case 'equation':
      return block.latex
    case 'figureAnchor':
      return undefined
  }
}

/**
 * FULL v2 traversal traceability (DET-281). Every fragment that carries source
 * content must reference non-empty, KNOWN block ids: typed blocks, subsections,
 * abstract, keyTerms, sourceExamples, caveats, AND readingAids.highlights +
 * calloutPlacements entries when present (forward-compat for W6/W7). Empty or
 * unknown ids → high `structuralFindings` + a traceability violation.
 */
export function checkFullTraceability(
  input: SourcePreservingArticle | ArticleJsonV2,
  known: ReadonlySet<string>,
): StructuralCheckResult {
  const article = toArticleV2(input)
  const findings: FidelityFinding[] = []
  let violation = false

  const checkIds = (ids: string[], where: string, ref?: string) => {
    if (ids.length === 0) {
      violation = true
      findings.push({
        severity: 'high',
        description: `${where} has no sourceBlockIds — untraceable.`,
        ...(ref ? { articleRef: ref } : {}),
      })
      return
    }
    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      violation = true
      findings.push({
        severity: 'high',
        description: `${where} references unknown block ids: ${unknown.join(
          ', ',
        )}.`,
        ...(ref ? { articleRef: ref } : {}),
        sourceBlockIds: unknown,
      })
    }
  }

  if (article.subtitle) checkIds(article.subtitle.sourceBlockIds, 'Subtitle')
  for (const p of article.abstract)
    checkIds(p.sourceBlockIds, `Abstract paragraph ${p.id}`, p.id)

  walkSections(article.sections, (s) => {
    for (const b of s.blocks)
      checkIds(b.sourceBlockIds, `Block ${b.id} (${b.type})`, b.id)
  })

  article.keyTerms.forEach((t, i) =>
    checkIds(t.sourceBlockIds, `keyTerm "${t.term}"`, `keyTerm-${i}`),
  )
  article.sourceExamples.forEach((e, i) =>
    checkIds(e.sourceBlockIds, `sourceExample #${i}`, `sourceExample-${i}`),
  )
  article.caveats.forEach((c, i) =>
    checkIds(c.sourceBlockIds, `caveat #${i}`, `caveat-${i}`),
  )

  // Reading-aid highlights (W7) must be traceable too.
  article.readingAids?.highlights?.forEach((h, i) =>
    checkIds(h.sourceBlockIds, `readingAids highlight #${i}`, `highlight-${i}`),
  )

  return { structuralFindings: findings, traceabilityViolation: violation }
}

/**
 * END-MATTER traceability ONLY (DET-281): subtitle, keyTerms, sourceExamples,
 * caveats. Used by the service, which already walks abstract/blocks/headings
 * inline (and highlights via `checkUnsupportedHighlights`) — this avoids
 * double-counting those into `structuralFindings` while still enforcing the new
 * surfaces. Empty / unknown ids → high structuralFinding + traceability
 * violation.
 */
export function checkEndMatterTraceability(
  input: SourcePreservingArticle | ArticleJsonV2,
  known: ReadonlySet<string>,
): StructuralCheckResult {
  const article = toArticleV2(input)
  const findings: FidelityFinding[] = []
  let violation = false

  const checkIds = (ids: string[], where: string, ref?: string) => {
    if (ids.length === 0) {
      violation = true
      findings.push({
        severity: 'high',
        description: `${where} has no sourceBlockIds — untraceable.`,
        ...(ref ? { articleRef: ref } : {}),
      })
      return
    }
    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      violation = true
      findings.push({
        severity: 'high',
        description: `${where} references unknown block ids: ${unknown.join(
          ', ',
        )}.`,
        ...(ref ? { articleRef: ref } : {}),
        sourceBlockIds: unknown,
      })
    }
  }

  if (article.subtitle) checkIds(article.subtitle.sourceBlockIds, 'Subtitle')
  article.keyTerms.forEach((t, i) =>
    checkIds(t.sourceBlockIds, `keyTerm "${t.term}"`, `keyTerm-${i}`),
  )
  article.sourceExamples.forEach((e, i) =>
    checkIds(e.sourceBlockIds, `sourceExample #${i}`, `sourceExample-${i}`),
  )
  article.caveats.forEach((c, i) =>
    checkIds(c.sourceBlockIds, `caveat #${i}`, `caveat-${i}`),
  )

  return { structuralFindings: findings, traceabilityViolation: violation }
}

// A trailing dash attribution: em-dash / en-dash / horizontal-bar / "--" / "- "
// followed by a Capitalized name at the END of the text. Conservative on purpose.
const DASH_ATTRIBUTION_RE =
  /(?:[—–―]|--|\s-)\s*([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,3})\s*$/u
// An "according to X" lead-in. The lead-in is case-insensitive (matches
// "According"/"according"); the name must start UPPERCASE so we don't capture
// articles like "the"/"a".
const ACCORDING_TO_RE = /[Aa]ccording to\s+([A-Z][\p{L}'.-]+)/u

/** Extract an attribution name from a source block, if one is present. */
function extractAttribution(text: string): string | undefined {
  const trimmed = text.trim()
  const dash = DASH_ATTRIBUTION_RE.exec(trimmed)
  if (dash) return dash[1].trim()
  const acc = ACCORDING_TO_RE.exec(trimmed)
  if (acc) return acc[1].trim()
  return undefined
}

/**
 * Quote ATTRIBUTION-loss heuristic (DET-281, MEDIUM, non-blocking). For each
 * quote block: if a cited source block's text carries an attribution pattern
 * (em-dash/`--`/`―`/trailing `- Name`, or "according to X") and the article
 * quote has no `attribution` field and its own text does not contain that name,
 * flag a medium structural finding. Conservative — only fires when an
 * attribution is clearly present in the source and clearly absent in the quote.
 */
export function checkQuoteAttribution(
  input: SourcePreservingArticle | ArticleJsonV2,
  sourceBlocks: readonly SourceBlockText[],
): FidelityFinding[] {
  const article = toArticleV2(input)
  const byId = new Map(sourceBlocks.map((b) => [b.id, b.text]))
  const findings: FidelityFinding[] = []

  for (const block of allBlocks(article)) {
    if (block.type !== 'quote') continue
    if (block.attribution) continue
    const quoteText = block.text.toLowerCase()
    for (const id of block.sourceBlockIds) {
      const src = byId.get(id)
      if (!src) continue
      const name = extractAttribution(src)
      if (!name) continue
      if (quoteText.includes(name.toLowerCase())) continue
      findings.push({
        severity: 'medium',
        description: `Quote ${block.id} cites a source attributed to "${name}" but the quote has no attribution and omits the name.`,
        articleRef: block.id,
        sourceBlockIds: [id],
      })
      break
    }
  }

  return findings
}

/**
 * DUPLICATE full-rendering check (DET-281). Same normalized text appearing:
 *  - twice across section blocks, OR
 *  - in a section block AND a top-level caveat/sourceExample/keyTerm,
 * is a medium structural finding — EXCEPT pullQuote blocks, whose whole job is
 * to re-display source text for emphasis (exempt). If a CAVEAT is the duplicated
 * content (and the other side is not a pullQuote) → HIGH severity (blocks).
 *
 * `calloutPlacements` (DET-272) is INTENTIONALLY NOT walked here: those entries
 * are the SAME end-matter items re-placed inline (references with placement
 * metadata, per plan decision 8), not a second full rendering. The walk only
 * visits section `blocks` + the top-level caveat/example/keyTerm arrays, so a
 * placed callout can never collide with its own source array — keep it that way
 * if this walk is extended.
 */
export function checkDuplicateRendering(
  input: SourcePreservingArticle | ArticleJsonV2,
): { findings: FidelityFinding[]; highSeverity: boolean } {
  const article = toArticleV2(input)
  const findings: FidelityFinding[] = []
  let high = false

  type Entry = {
    norm: string
    label: string
    isPullQuote: boolean
    isCaveat: boolean
  }
  const entries: Entry[] = []

  for (const block of allBlocks(article)) {
    const text = blockText(block)
    if (!text) continue
    const norm = normalizeText(text)
    if (!norm) continue
    entries.push({
      norm,
      label: `block ${block.id} (${block.type})`,
      isPullQuote: block.type === 'pullQuote',
      isCaveat: false,
    })
  }
  article.caveats.forEach((c, i) => {
    const norm = normalizeText(c.text)
    if (norm)
      entries.push({
        norm,
        label: `caveat #${i}`,
        isPullQuote: false,
        isCaveat: true,
      })
  })
  article.sourceExamples.forEach((e, i) => {
    const norm = normalizeText(e.text)
    if (norm)
      entries.push({
        norm,
        label: `sourceExample #${i}`,
        isPullQuote: false,
        isCaveat: false,
      })
  })
  article.keyTerms.forEach((t, i) => {
    const norm = normalizeText(t.term)
    if (norm)
      entries.push({
        norm,
        label: `keyTerm #${i}`,
        isPullQuote: false,
        isCaveat: false,
      })
  })

  // Group by normalized text; any group with 2+ entries is a duplicate set.
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const g = groups.get(e.norm)
    if (g) g.push(e)
    else groups.set(e.norm, [e])
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    // pullQuote re-display is allowed: a duplicate is only flagged when at least
    // two of the duplicated entries are NON-pullQuote.
    const nonPull = group.filter((e) => !e.isPullQuote)
    if (nonPull.length < 2) continue
    const involvesCaveat = nonPull.some((e) => e.isCaveat)
    const severity = involvesCaveat ? 'high' : 'medium'
    if (severity === 'high') high = true
    findings.push({
      severity,
      description: `Duplicate rendering of the same content in ${nonPull
        .map((e) => e.label)
        .join(' and ')}.`,
    })
  }

  return { findings, highSeverity: high }
}

/**
 * UNSUPPORTED reading-aid highlights (DET-281, HIGH, blocks). Any
 * readingAids.highlight with empty or unknown sourceBlockIds. (The W7 generator
 * will also omit such highlights; the checker enforces it regardless.)
 */
export function checkUnsupportedHighlights(
  input: SourcePreservingArticle | ArticleJsonV2,
  known: ReadonlySet<string>,
): FidelityFinding[] {
  const article = toArticleV2(input)
  const findings: FidelityFinding[] = []
  article.readingAids?.highlights?.forEach((h, i) => {
    if (h.sourceBlockIds.length === 0) {
      findings.push({
        severity: 'high',
        description: `Reading-aid highlight #${i} has no sourceBlockIds — untraceable.`,
        articleRef: `highlight-${i}`,
      })
      return
    }
    const unknown = h.sourceBlockIds.filter((id) => !known.has(id))
    if (unknown.length > 0)
      findings.push({
        severity: 'high',
        description: `Reading-aid highlight #${i} references unknown block ids: ${unknown.join(
          ', ',
        )}.`,
        articleRef: `highlight-${i}`,
        sourceBlockIds: unknown,
      })
  })
  return findings
}

/** A source block as the procedure check consumes it (id + type + text). */
export interface SourceBlockTyped {
  id: string
  type: string
  text: string
}

// Ordered-list markers at a line start: "1." / "1)" / "a." / "a)" / "i." etc.
const ORDERED_MARKER_RE = /^\s*(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]\s+/

/**
 * Is a source LIST block an ORDERED list? The source block type is only "LIST"
 * (no ordered flag — see the generator prompt), so we detect ordering from the
 * text: two or more lines that start with a numeric/lettered/roman marker.
 */
function isOrderedSourceList(block: SourceBlockTyped): boolean {
  if (block.type !== 'LIST') return false
  const marked = block.text
    .split('\n')
    .filter((line) => ORDERED_MARKER_RE.test(line)).length
  return marked >= 2
}

/**
 * PROCEDURE ordered-steps preservation (DET-273, HIGH, blocks). Only runs when
 * `shape === 'procedure'`. For every source ORDERED-list block the article cites,
 * at least one `list` article block must carry it: if an ordered source list was
 * cited ONLY by non-list (prose/paragraph) blocks, the steps were flattened into
 * prose — a high `structuralFinding` that blocks approval. Non-procedure shapes
 * are not flagged by this check (it returns nothing).
 *
 * Deterministic: ordering itself is the reshaping-plan warning's job; this check
 * enforces only that the ordered source LIST stays a list block, in source order
 * is preserved within the list block by the generator's verbatim-items rule.
 */
export function checkProcedureListPreservation(
  input: SourcePreservingArticle | ArticleJsonV2,
  shape: ArticleShape | undefined,
  sourceBlocks: readonly SourceBlockTyped[],
): FidelityFinding[] {
  if (shape !== 'procedure') return []
  const article = toArticleV2(input)
  const orderedListIds = new Set(
    sourceBlocks.filter(isOrderedSourceList).map((b) => b.id),
  )
  if (orderedListIds.size === 0) return []

  // For each ordered source-list id: did ANY article `list` block cite it, and
  // was it cited by any block at all?
  const citedByList = new Set<string>()
  const citedAtAll = new Set<string>()
  for (const block of allBlocks(article)) {
    for (const id of block.sourceBlockIds) {
      if (!orderedListIds.has(id)) continue
      citedAtAll.add(id)
      if (block.type === 'list') citedByList.add(id)
    }
  }

  const findings: FidelityFinding[] = []
  for (const id of orderedListIds) {
    // Only flag a list the article actually used — an unused source list is a
    // coverage concern, not a flattening one.
    if (citedAtAll.has(id) && !citedByList.has(id)) {
      findings.push({
        severity: 'high',
        description: `Procedure shape: source ordered list ${id} was flattened into prose — it must stay an ordered list block so the steps keep their order.`,
        sourceBlockIds: [id],
      })
    }
  }
  return findings
}
