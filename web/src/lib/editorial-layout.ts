import type {
  ArticleEnrichment,
  EditorialLayout,
  IllustrationSuggestion,
  InlineRun,
} from './api'
import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  orderedBlocks,
  orderedSections,
} from './article-v2'

/**
 * Editorial layout engine (DET-318, Wave C) — a PURE, deterministic builder that
 * resolves an Article JSON v2 + its optional editorial lanes into a render-ready
 * `EditorialPlan`. The Compendium renderer consumes the plan verbatim instead of
 * mapping blocks ad-hoc; encoding the Kibadist Article Structure rules here (not
 * in JSX) makes the layout correct for ANY source — thin or rich — and unit
 * testable without React.
 *
 * The rules this module encodes (the product requirement):
 *  - Illustrations are NEVER front-loaded. A plate sits AFTER the opening 1–2
 *    paragraphs of the section it belongs to; an unanchored cover lands in the
 *    FIRST section's opening, never at the top of the stream. Roughly one plate
 *    per section. `editorial_cover`/`decorative_section` → full-width `span`
 *    hero; `source_based_diagram` → in-column `Fig. N`. Figure numbers are
 *    sequential; a `(Fig. N)` reference binds to the anchor paragraph; captions
 *    split into a bold takeaway + a detail sentence.
 *  - ≥3 rhythm devices, SPREAD: a drop-cap lead on the first body paragraph,
 *    ONE stat band, ONE pull-quote, 1–3 marginal notes.
 *  - Cadence: never pass ~3 consecutive plain paragraphs without a landmark
 *    where a device is available to interleave; long sections (>~7 paragraphs)
 *    get a sub-head break.
 *
 * Server-generated editorial furniture (`editorialLayout`) takes precedence over
 * derived furniture; anything not grounded in the source is marked `ai: true` so
 * the renderer can surface the "✦ AI · not from your source" honesty mark.
 */

// --- Output shape ------------------------------------------------------------

/** A run of editorial text that the renderer flows (runs preferred, plain text
 *  fallback for server-generated furniture). `ai` flags ungrounded furniture. */
export interface EditorialText {
  runs?: InlineRun[]
  text?: string
  ai: boolean
}

/** Figure size: a full-width section hero, or an in-column secondary `Fig. N`. */
export type FigureSize = 'span' | 'column'

/** A placed figure derived from a rendered illustration suggestion. */
export interface PlannedFigure {
  suggestion: IllustrationSuggestion
  size: FigureSize
  figureNumber: number
  /** Place AFTER this many opening paragraphs of the section (never front-loaded). */
  afterParagraphIndex: number
  /** Two-part teaching caption: a bold takeaway clause + a detail sentence. */
  caption: { takeaway: string; detail: string }
  /** Honesty mark: AI-authored illustration furniture is always flagged. */
  ai: boolean
}

/** One stat in the full-width stat band. */
export interface PlannedStat {
  figure: string
  label: string
}

/** An ordered item in a section's render stream — a discriminated union the
 *  renderer maps 1:1 onto the magazine vocabulary. */
export type StreamItem =
  | {
      kind: 'block'
      block: ArticleBlockV2
      /** First body paragraph of the article — gets the drop-cap lead. */
      isLead?: boolean
      /** Figure number to inject as a `(Fig. N)` ref at the paragraph's end. */
      figureRef?: number
    }
  | { kind: 'subhead'; text: string }
  | { kind: 'figure'; figure: PlannedFigure }
  | { kind: 'statband'; stats: PlannedStat[]; ai: boolean }
  | { kind: 'pullquote'; text: string; attribution?: string; ai: boolean }
  | {
      kind: 'marginal'
      title: string
      text: string
      ai: boolean
      /** Source block id when this marginal is a CONSUMED callout block (DET-358).
       *  Lets the renderer resolve the callout's source trace and keep it
       *  inspectable even though the layout routed it away from `MagazineBlock`.
       *  Absent for server-authored marginal furniture (no traceable source). */
      blockId?: string
    }

export interface PlannedSection {
  sectionId: string
  heading: string
  /** Display number (1-based, in stream order — abstract excluded). */
  index: number
  items: StreamItem[]
}

export interface EditorialPlan {
  kicker: string
  kickerAi: boolean
  /** The full-width lede above the columns; null when there is none. */
  standfirst: EditorialText | null
  /** The abstract lede section lifted above the columns (faithful, grounded). */
  ledeParagraphs: { blockId: string; runs: InlineRun[] }[]
  sections: PlannedSection[]
}

// --- Builder -----------------------------------------------------------------

export interface BuildEditorialPlanArgs {
  article: ArticleV2
  /** Only approved + rendered suggestions become plates. */
  illustrations?: IllustrationSuggestion[]
  enrichment?: ArticleEnrichment | null
  /** Server-generated furniture; may be null/absent (Layer 1 still renders). */
  editorialLayout?: EditorialLayout | null
}

const DEFAULT_KICKER = 'Kibadist Compendium · Entry'
// After how many opening paragraphs a section's hero plate may sit (rule: 1–2).
const OPENING_PARAGRAPHS = 2
// A section longer than this gets a deterministic sub-head break (rule: >~7).
const LONG_SECTION_PARAGRAPHS = 7
// Max plain paragraphs in a row before the cadence guard inserts a landmark.
const MAX_PLAIN_RUN = 3

export function buildEditorialPlan({
  article,
  illustrations = [],
  enrichment,
  editorialLayout,
}: BuildEditorialPlanArgs): EditorialPlan {
  const allSections = orderedSections(article)

  // The adapter surfaces the source abstract as the first section (its
  // section_id ends with `-abstract`). It is a faithful, grounded lede lifted
  // above the two columns and excluded from the stream + section numbering.
  const first = allSections[0]
  const hasAbstract = Boolean(first?.section_id?.endsWith('-abstract'))
  const ledeSection = hasAbstract ? first : null
  const sections = hasAbstract ? allSections.slice(1) : allSections

  const ledeParagraphs = ledeSection
    ? orderedBlocks(ledeSection)
        .filter(isParagraph)
        .map((b) => ({ blockId: b.block_id, runs: b.content.runs }))
    : []

  // --- Spine: kicker + standfirst ------------------------------------------
  const kickerText =
    editorialLayout?.kicker?.text ??
    enrichment?.classification ??
    DEFAULT_KICKER
  const kickerAi = editorialLayout?.kicker
    ? !editorialLayout.kicker.grounded
    : Boolean(enrichment?.classification)

  // Prefer the faithful abstract lede; else the (possibly AI) server standfirst.
  let standfirst: EditorialText | null = null
  if (ledeParagraphs.length > 0) {
    standfirst = null // the lede renders as its own grounded block above columns
  } else if (editorialLayout?.standfirst) {
    standfirst = {
      text: editorialLayout.standfirst.text,
      ai: !editorialLayout.standfirst.grounded,
    }
  }

  // Only rendered, approved illustrations become plates.
  const readyIllus = illustrations.filter(
    (s) => s.approval === 'approved' && s.image,
  )

  // --- Resolve figure placements -------------------------------------------
  // Anchored by SOURCE provenance, then spread across sections so plates never
  // cluster (rule: roughly one per section); server figurePlacements win.
  const figurePlan = resolveFigurePlacements({
    illustrations: readyIllus,
    sections,
    editorialLayout,
  })

  // --- Resolve the one stat band -------------------------------------------
  const statBand = resolveStatBand({ sections, editorialLayout })

  // --- Resolve the one pull-quote ------------------------------------------
  const pullQuote = resolvePullQuote({ sections, editorialLayout })

  // --- Resolve 1–3 marginal notes ------------------------------------------
  const marginals = resolveMarginals({ sections, editorialLayout })

  // --- Resolve sub-heads ----------------------------------------------------
  const subheads = resolveSubheads({ sections, editorialLayout })

  // --- Assemble each section's ordered stream ------------------------------
  // The drop-cap lead is used once, on the FIRST body paragraph of the stream
  // (the abstract lede sits above the columns and never carries the drop-cap).
  const leadState = { used: false }

  const plannedSections: PlannedSection[] = sections.map((section, i) =>
    buildSection({
      section,
      index: i + 1,
      leadState,
      figures: figurePlan.bySection.get(section.section_id) ?? [],
      figureRefs: figurePlan.refByBlockId,
      statBand: statBand?.sectionId === section.section_id ? statBand : null,
      pullQuote: pullQuote?.sectionId === section.section_id ? pullQuote : null,
      marginals: marginals.filter((m) => m.sectionId === section.section_id),
      subheads: subheads.filter((s) => s.sectionId === section.section_id),
    }),
  )

  return {
    kicker: kickerText,
    kickerAi,
    standfirst,
    ledeParagraphs,
    sections: plannedSections,
  }
}

// --- Figure placement --------------------------------------------------------

/** An illustration with its preferred section resolved, before spreading. */
interface PendingFigure {
  suggestion: IllustrationSuggestion
  size: FigureSize
  /** Server-pinned after-index, or null to default to the opening paragraphs. */
  serverAfter: number | null
  /** Preferred section id (server pin or source anchor), or null if unanchored. */
  preferred: string | null
  /** True only when the server explicitly placed this figure. */
  pinned: boolean
}

function resolveFigurePlacements(args: {
  illustrations: IllustrationSuggestion[]
  sections: ArticleSectionV2[]
  editorialLayout?: EditorialLayout | null
}): {
  bySection: Map<string, PlannedFigure[]>
  refByBlockId: Map<string, number>
} {
  const { illustrations, sections, editorialLayout } = args
  const bySection = new Map<string, PlannedFigure[]>()
  const refByBlockId = new Map<string, number>()

  if (sections.length === 0 || illustrations.length === 0) {
    return { bySection, refByBlockId }
  }

  // Map a SOURCE-document block id → the section that represents it. Article
  // blocks carry their source provenance in `source_span_ids` — the SAME id
  // space illustration.sourceBlockIds live in — never `block_id`. First section
  // to cite a source id owns it.
  const srcToSection = new Map<string, string>()
  for (const sec of sections) {
    for (const sid of sec.source_span_ids ?? []) {
      if (!srcToSection.has(sid)) srcToSection.set(sid, sec.section_id)
    }
    for (const b of sec.blocks) {
      for (const sid of b.source_span_ids ?? []) {
        if (!srcToSection.has(sid)) srcToSection.set(sid, sec.section_id)
      }
    }
  }

  // Paragraph block ids per section, in order — used to bind a `(Fig. N)` ref.
  const sectionParagraphs = new Map<string, string[]>()
  for (const sec of sections) {
    sectionParagraphs.set(
      sec.section_id,
      orderedBlocks(sec)
        .filter(isParagraph)
        .map((b) => b.block_id),
    )
  }

  const sectionIds = sections.map((s) => s.section_id)
  const serverById = new Map(
    (editorialLayout?.figurePlacements ?? []).map((p) => [p.suggestionId, p]),
  )

  // Resolve each illustration's PREFERRED section: a server pin, else the first
  // section its source provenance anchors to, else none (unanchored).
  const pending: PendingFigure[] = illustrations.map((s) => {
    const server = serverById.get(s.id)
    if (server && sectionExists(server.sectionId, sections)) {
      return {
        suggestion: s,
        size: server.size,
        serverAfter: server.afterParagraphIndex,
        preferred: server.sectionId,
        pinned: true,
      }
    }
    const anchored = (s.sourceBlockIds ?? [])
      .map((id) => srcToSection.get(id))
      .find(Boolean)
    return {
      suggestion: s,
      size: figureSize(s.illustrationType),
      serverAfter: null,
      preferred: anchored ?? null,
      pinned: false,
    }
  })

  // SPREAD so plates never cluster (rule: roughly one per section). Server pins
  // are honored exactly (even if they double up). Each remaining figure takes
  // its preferred section when still free, else the nearest later free section
  // (wrapping); only once EVERY section already has a plate does it overflow.
  const used = new Set<string>()
  const placed: { sectionId: string; after: number; p: PendingFigure }[] = []
  const takeFree = (start: number): string | null => {
    for (let i = 0; i < sectionIds.length; i++) {
      const id = sectionIds[(start + i) % sectionIds.length]
      if (!used.has(id)) return id
    }
    return null
  }
  for (const p of pending.filter((x) => x.pinned)) {
    const id = p.preferred as string
    used.add(id)
    placed.push({
      sectionId: id,
      after: p.serverAfter ?? OPENING_PARAGRAPHS,
      p,
    })
  }
  for (const p of pending.filter((x) => !x.pinned)) {
    const prefIdx = p.preferred ? sectionIds.indexOf(p.preferred) : 0
    const id =
      p.preferred && !used.has(p.preferred)
        ? p.preferred
        : (takeFree(prefIdx < 0 ? 0 : prefIdx) ?? p.preferred ?? sectionIds[0])
    used.add(id)
    placed.push({ sectionId: id, after: OPENING_PARAGRAPHS, p })
  }

  // Number ONLY in-column figures (the ones that show "Fig. N"), sequentially in
  // reading order; span heroes show "PLATE" with no number, so they carry no
  // number and bind no `(Fig. N)` prose ref (which would otherwise dangle).
  placed.sort((a, b) => {
    const sa = sectionIds.indexOf(a.sectionId)
    const sb = sectionIds.indexOf(b.sectionId)
    if (sa !== sb) return sa - sb
    return a.after - b.after
  })
  let figNo = 0
  for (const { sectionId, after, p } of placed) {
    const isColumn = p.size === 'column'
    const figureNumber = isColumn ? ++figNo : 0
    const server = serverById.get(p.suggestion.id)
    const planned: PlannedFigure = {
      suggestion: p.suggestion,
      size: p.size,
      figureNumber,
      afterParagraphIndex: after,
      caption: server?.caption ?? splitCaption(p.suggestion.caption),
      // Illustration furniture is AI-authored — always honest about it.
      ai: true,
    }
    const arr = bySection.get(sectionId) ?? []
    arr.push(planned)
    bySection.set(sectionId, arr)
    if (isColumn) {
      const paras = sectionParagraphs.get(sectionId) ?? []
      const anchorIdx = Math.min(
        Math.max(after - 1, 0),
        Math.max(paras.length - 1, 0),
      )
      if (paras.length > 0) refByBlockId.set(paras[anchorIdx], figureNumber)
    }
  }

  // Stable order within a section (by after-index).
  for (const arr of bySection.values()) {
    arr.sort((a, b) => a.afterParagraphIndex - b.afterParagraphIndex)
  }

  return { bySection, refByBlockId }
}

function figureSize(
  type: IllustrationSuggestion['illustrationType'],
): FigureSize {
  // source_based_diagram → in-column secondary Fig.; cover/decorative → hero.
  return type === 'source_based_diagram' ? 'column' : 'span'
}

/** Split a caption into a bold takeaway (first sentence) + the remaining detail. */
export function splitCaption(caption: string): {
  takeaway: string
  detail: string
} {
  const trimmed = (caption ?? '').trim()
  if (!trimmed) return { takeaway: '', detail: '' }
  // First sentence = up to the first sentence terminator (., !, ?) followed by
  // whitespace or end. Keep it deterministic and abbreviation-tolerant enough.
  const match = trimmed.match(/^(.*?[.!?])(\s+)(.*)$/s)
  if (match && match[1] && match[3]) {
    return {
      takeaway: stripTrailingPunct(match[1]),
      detail: match[3].trim(),
    }
  }
  // No clean split — the whole caption is the takeaway.
  return { takeaway: stripTrailingPunct(trimmed), detail: '' }
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, '').trim()
}

// --- Stat band ---------------------------------------------------------------

interface ResolvedStatBand {
  sectionId: string
  stats: PlannedStat[]
  ai: boolean
}

// Numeric-cluster scan: percentages, multipliers, years, grouped thousands, and
// plain magnitudes. Deterministic so the placement is testable.
const NUMERIC_RE =
  /\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?%|\d+(?:\.\d+)?×|\d+(?:\.\d+)?x|\b(?:1[5-9]\d{2}|20\d{2})\b|\d+(?:\.\d+)?)\b/g

function resolveStatBand(args: {
  sections: ArticleSectionV2[]
  editorialLayout?: EditorialLayout | null
}): ResolvedStatBand | null {
  const { sections, editorialLayout } = args
  if (sections.length === 0) return null

  // Server furniture wins — place it in the section where numbers cluster most
  // (or the first section if no numbers exist anywhere).
  if (editorialLayout?.statBand && editorialLayout.statBand.stats.length > 0) {
    const target = densestNumericSection(sections) ?? sections[0].section_id
    return {
      sectionId: target,
      stats: editorialLayout.statBand.stats.map((s) => ({
        figure: s.figure,
        label: s.label,
      })),
      ai: !editorialLayout.statBand.grounded,
    }
  }

  // Derive from the densest numeric section; need ≥2 figures to form a band.
  let bestSection: string | null = null
  let bestStats: PlannedStat[] = []
  for (const sec of sections) {
    const found = extractStats(sec)
    if (found.length > bestStats.length) {
      bestStats = found
      bestSection = sec.section_id
    }
  }
  if (!bestSection || bestStats.length < 2) return null
  return {
    sectionId: bestSection,
    // Cap at 4 to fit the band grid; first occurrences win (reading order).
    stats: bestStats.slice(0, 4),
    // Derived from the source's own numbers — grounded, not AI furniture.
    ai: false,
  }
}

function densestNumericSection(sections: ArticleSectionV2[]): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const sec of sections) {
    const count = countNumeric(sec)
    if (count > bestCount) {
      bestCount = count
      best = sec.section_id
    }
  }
  return bestCount > 0 ? best : null
}

function countNumeric(section: ArticleSectionV2): number {
  let count = 0
  for (const b of orderedBlocks(section)) {
    if (b.type !== 'paragraph' && b.type !== 'list') continue
    const matches = blockPlainText(b).match(NUMERIC_RE)
    if (matches) count += matches.length
  }
  return count
}

function extractStats(section: ArticleSectionV2): PlannedStat[] {
  const stats: PlannedStat[] = []
  const seen = new Set<string>()
  for (const b of orderedBlocks(section)) {
    if (b.type !== 'paragraph' && b.type !== 'list') continue
    const text = blockPlainText(b)
    for (const sentence of splitSentences(text)) {
      const m = sentence.match(NUMERIC_RE)
      if (!m) continue
      const figure = m[0]
      if (seen.has(figure)) continue
      seen.add(figure)
      stats.push({ figure, label: statLabel(sentence, figure) })
      if (stats.length >= 6) return stats
    }
  }
  return stats
}

// A short label for a derived figure — the few words around it, mono-cased.
function statLabel(sentence: string, figure: string): string {
  const words = sentence
    .replace(figure, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
  return words.join(' ') || 'figure'
}

// --- Pull-quote --------------------------------------------------------------

interface ResolvedPullQuote {
  sectionId: string
  text: string
  attribution?: string
  ai: boolean
}

function resolvePullQuote(args: {
  sections: ArticleSectionV2[]
  editorialLayout?: EditorialLayout | null
}): ResolvedPullQuote | null {
  const { sections, editorialLayout } = args
  if (sections.length === 0) return null

  if (editorialLayout?.pullQuote) {
    const pq = editorialLayout.pullQuote
    const target = sectionExists(pq.sectionId, sections)
      ? pq.sectionId
      : midSection(sections)
    return { sectionId: target, text: pq.text, ai: !pq.grounded }
  }

  // An explicit quote block is the natural pull-quote — prefer the first one.
  for (const sec of sections) {
    for (const b of orderedBlocks(sec)) {
      if (b.type === 'quote') {
        return {
          sectionId: sec.section_id,
          text: blockPlainText(b),
          attribution: b.content.attribution,
          ai: false,
        }
      }
    }
  }

  // Else pick the single sharpest sentence near mid-article: short and punchy.
  const candidate = sharpestSentence(sections)
  if (!candidate) return null
  return {
    sectionId: candidate.sectionId,
    text: candidate.text,
    // Lifted verbatim from the source body — grounded, not AI.
    ai: false,
  }
}

function midSection(sections: ArticleSectionV2[]): string {
  return (
    sections[Math.floor(sections.length / 2)]?.section_id ??
    sections[0].section_id
  )
}

interface SentencePick {
  sectionId: string
  text: string
}

// A "sharp" sentence: short (6–22 words), declarative, near mid-article. We
// score by closeness to the article midpoint and brevity, deterministically.
function sharpestSentence(sections: ArticleSectionV2[]): SentencePick | null {
  const all: { sectionId: string; text: string; words: number; pos: number }[] =
    []
  let para = 0
  let total = 0
  // First pass to count body paragraphs for a midpoint.
  for (const sec of sections) {
    for (const b of orderedBlocks(sec)) {
      if (isParagraph(b)) total += 1
    }
  }
  const mid = total / 2 || 0.5
  for (const sec of sections) {
    for (const b of orderedBlocks(sec)) {
      if (!isParagraph(b)) continue
      const pos = para
      para += 1
      for (const sentence of splitSentences(blockPlainText(b))) {
        const words = sentence.split(/\s+/).filter(Boolean).length
        if (words < 6 || words > 22) continue
        all.push({ sectionId: sec.section_id, text: sentence, words, pos })
      }
    }
  }
  if (all.length === 0) return null
  // Lower score is better: distance from mid (paragraphs) + brevity bonus.
  all.sort((a, b) => {
    const da = Math.abs(a.pos - mid) + a.words * 0.05
    const db = Math.abs(b.pos - mid) + b.words * 0.05
    if (da !== db) return da - db
    // Stable tiebreak by position then text so the pick is deterministic.
    if (a.pos !== b.pos) return a.pos - b.pos
    return a.text.localeCompare(b.text)
  })
  const best = all[0]
  return { sectionId: best.sectionId, text: best.text }
}

// --- Marginal notes ----------------------------------------------------------

interface ResolvedMarginal {
  sectionId: string
  afterParagraphIndex: number
  title: string
  text: string
  ai: boolean
  /** The source callout block id this marginal was derived from (DET-358), so
   *  the renderer can keep the consumed callout inspectable. Absent for server
   *  marginal furniture, which has no single traceable source block. */
  blockId?: string
}

function resolveMarginals(args: {
  sections: ArticleSectionV2[]
  editorialLayout?: EditorialLayout | null
}): ResolvedMarginal[] {
  const { sections, editorialLayout } = args
  if (sections.length === 0) return []

  if (editorialLayout?.marginalNotes && editorialLayout.marginalNotes.length) {
    return editorialLayout.marginalNotes
      .filter((m) => sectionExists(m.sectionId, sections))
      .slice(0, 3)
      .map((m) => ({
        sectionId: m.sectionId,
        afterParagraphIndex: m.afterParagraphIndex,
        title: m.title,
        text: m.text,
        ai: !m.grounded,
      }))
  }

  // Derive from existing callout blocks — the article's own asides. Spread one
  // per section, cap at 3. Grounded (lifted from the source).
  const out: ResolvedMarginal[] = []
  for (const sec of sections) {
    if (out.length >= 3) break
    const blocks = orderedBlocks(sec)
    let paraCount = 0
    for (const b of blocks) {
      if (isParagraph(b)) paraCount += 1
      if (b.type === 'callout') {
        out.push({
          sectionId: sec.section_id,
          afterParagraphIndex: paraCount,
          title: b.content.title ?? b.content.variant ?? 'Note',
          text: blockPlainText(b),
          ai: false,
          // Carry the callout's block id so the rendered marginal stays
          // source-trace inspectable (DET-358) — the trace index is keyed by it.
          blockId: b.block_id,
        })
        break // one per section keeps them spread
      }
    }
  }
  return out
}

// --- Sub-heads ---------------------------------------------------------------

interface ResolvedSubhead {
  sectionId: string
  afterParagraphIndex: number
  text: string
}

function resolveSubheads(args: {
  sections: ArticleSectionV2[]
  editorialLayout?: EditorialLayout | null
}): ResolvedSubhead[] {
  const { sections, editorialLayout } = args
  if (sections.length === 0) return []

  if (editorialLayout?.subheads && editorialLayout.subheads.length) {
    return editorialLayout.subheads
      .filter((s) => sectionExists(s.sectionId, sections))
      .map((s) => ({
        sectionId: s.sectionId,
        afterParagraphIndex: s.afterParagraphIndex,
        text: s.text,
      }))
  }

  // Derive: a long section (>~7 paragraphs) with no existing heading block gets
  // a mid-point break so the column never runs as one undifferentiated block.
  const out: ResolvedSubhead[] = []
  for (const sec of sections) {
    const blocks = orderedBlocks(sec)
    const paraCount = blocks.filter(isParagraph).length
    const hasHeading = blocks.some((b) => b.type === 'heading')
    if (paraCount > LONG_SECTION_PARAGRAPHS && !hasHeading) {
      out.push({
        sectionId: sec.section_id,
        afterParagraphIndex: Math.floor(paraCount / 2),
        text: 'Continued',
      })
    }
  }
  return out
}

// --- Section assembly --------------------------------------------------------

function buildSection(args: {
  section: ArticleSectionV2
  index: number
  leadState: { used: boolean }
  figures: PlannedFigure[]
  figureRefs: Map<string, number>
  statBand: ResolvedStatBand | null
  pullQuote: ResolvedPullQuote | null
  marginals: ResolvedMarginal[]
  subheads: ResolvedSubhead[]
}): PlannedSection {
  const {
    section,
    index,
    leadState,
    figures,
    figureRefs,
    statBand,
    pullQuote,
    marginals,
    subheads,
  } = args

  const blocks = orderedBlocks(section)
  const items: StreamItem[] = []

  // Index devices by the paragraph count they follow (afterParagraphIndex).
  const figByAfter = groupBy(figures, (f) => f.afterParagraphIndex)
  const subheadByAfter = groupBy(subheads, (s) => s.afterParagraphIndex)
  const marginalByAfter = groupBy(marginals, (m) => m.afterParagraphIndex)

  // A stat band / pull-quote attach to this section once, placed after its
  // opening paragraphs (a thesis peak); they are full-width landmarks.
  let statPlaced = !statBand
  let pullPlaced = !pullQuote

  let paraSeen = 0
  let plainRun = 0

  const flushAfter = (count: number) => {
    // Figures bound to "after `count` paragraphs".
    for (const fig of figByAfter.get(count) ?? []) {
      items.push({ kind: 'figure', figure: fig })
      plainRun = 0
    }
    // Sub-head breaks.
    for (const sh of subheadByAfter.get(count) ?? []) {
      items.push({ kind: 'subhead', text: sh.text })
      plainRun = 0
    }
    // Marginal notes.
    for (const m of marginalByAfter.get(count) ?? []) {
      items.push({
        kind: 'marginal',
        title: m.title,
        text: m.text,
        ai: m.ai,
        blockId: m.blockId,
      })
      plainRun = 0
    }
    // The full-width devices land right after the opening paragraphs.
    if (!statPlaced && statBand && count >= OPENING_PARAGRAPHS) {
      items.push({ kind: 'statband', stats: statBand.stats, ai: statBand.ai })
      statPlaced = true
      plainRun = 0
    }
    if (!pullPlaced && pullQuote && count >= OPENING_PARAGRAPHS) {
      items.push({
        kind: 'pullquote',
        text: pullQuote.text,
        attribution: pullQuote.attribution,
        ai: pullQuote.ai,
      })
      pullPlaced = true
      plainRun = 0
    }
  }

  for (const block of blocks) {
    if (block.type === 'divider') continue
    // A quote block is consumed by the pull-quote device — skip the duplicate
    // when this section owns the chosen pull-quote and it's that block.
    if (
      block.type === 'quote' &&
      pullQuote &&
      blockPlainText(block) === pullQuote.text
    ) {
      // Render via the pull-quote device instead of an in-column quote.
      if (!pullPlaced) {
        items.push({
          kind: 'pullquote',
          text: pullQuote.text,
          attribution: pullQuote.attribution,
          ai: pullQuote.ai,
        })
        pullPlaced = true
        plainRun = 0
      }
      continue
    }
    // A callout consumed by a marginal device — skip the duplicate.
    if (
      block.type === 'callout' &&
      marginals.some((m) => m.text === blockPlainText(block))
    ) {
      continue
    }

    if (isParagraph(block)) {
      const isLead = !leadState.used
      if (isLead) leadState.used = true
      const figureRef = figureRefs.get(block.block_id)
      items.push({ kind: 'block', block, isLead, figureRef })
      paraSeen += 1
      plainRun += 1
      flushAfter(paraSeen)
      // Cadence guard: if too many plain paragraphs piled up and a device is
      // still unplaced for this section, drop the next landmark in now.
      if (plainRun > MAX_PLAIN_RUN) {
        if (!statPlaced && statBand) {
          items.push({
            kind: 'statband',
            stats: statBand.stats,
            ai: statBand.ai,
          })
          statPlaced = true
          plainRun = 0
        } else if (!pullPlaced && pullQuote) {
          items.push({
            kind: 'pullquote',
            text: pullQuote.text,
            attribution: pullQuote.attribution,
            ai: pullQuote.ai,
          })
          pullPlaced = true
          plainRun = 0
        }
      }
    } else {
      // Non-paragraph blocks (list, table, code, heading, image) are landmarks.
      items.push({ kind: 'block', block })
      plainRun = 0
    }
  }

  // Any devices anchored past the section's paragraph count still get placed at
  // the end so nothing is silently dropped (e.g. a server after-index too big).
  if (!statPlaced && statBand) {
    items.push({ kind: 'statband', stats: statBand.stats, ai: statBand.ai })
  }
  if (!pullPlaced && pullQuote) {
    items.push({
      kind: 'pullquote',
      text: pullQuote.text,
      attribution: pullQuote.attribution,
      ai: pullQuote.ai,
    })
  }
  // Flush any figures/marginals/subheads whose after-index exceeded paraSeen.
  for (const [count, figs] of figByAfter) {
    if (count > paraSeen) {
      for (const fig of figs) items.push({ kind: 'figure', figure: fig })
    }
  }
  for (const [count, ms] of marginalByAfter) {
    if (count > paraSeen) {
      for (const m of ms)
        items.push({
          kind: 'marginal',
          title: m.title,
          text: m.text,
          ai: m.ai,
          blockId: m.blockId,
        })
    }
  }

  return {
    sectionId: section.section_id,
    heading: section.heading,
    index,
    items,
  }
}

// --- Helpers -----------------------------------------------------------------

function isParagraph(
  b: ArticleBlockV2,
): b is Extract<ArticleBlockV2, { type: 'paragraph' }> {
  return b.type === 'paragraph'
}

function sectionExists(id: string, sections: ArticleSectionV2[]): boolean {
  return sections.some((s) => s.section_id === id)
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const k = key(item)
    const arr = map.get(k) ?? []
    arr.push(item)
    map.set(k, arr)
  }
  return map
}
