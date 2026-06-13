/**
 * Pure source-kind detection + article-shape selection (DET-345).
 *
 * Everything here is deterministic and network-free: given the already-segmented,
 * classified blocks (+ optional source metadata) it computes the `DetectionSignals`,
 * scores each candidate `SourceKind`, picks the winner (or `unknown` when nothing is
 * confident enough), and maps the kind → `SourceArticleShape`. The pipeline calls
 * `diagnoseSource`; the rest are exported for focused unit tests.
 *
 * The detector is intentionally signal-driven rather than a rigid if-else cascade:
 * each kind contributes a score in [0, 1] and the max wins above a floor. That keeps
 * the rules independently testable and makes overlap (a doc that also has citations,
 * a transcript that also has a stray heading) degrade gracefully instead of falling
 * off a cliff at one threshold.
 *
 * NOTE on `classification`. `ClassifiedBlockInput.classification` is a free-form
 * string in practice (the golden fixtures use abstract 'CORE'/'NOISE'/'SUPPORTING'
 * values, not the Prisma `TransformerBlockClass` enum), so detection relies on block
 * TYPE + TEXT patterns + metadata — the inputs the ticket names — never on a specific
 * classification vocabulary. A CITATION classification, when present, is treated only
 * as an additive reference signal.
 */

import type {
  DetectionSignals,
  SourceArticleShape,
  SourceDiagnosis,
  SourceDiagnosisMetadata,
  SourceKind,
  SourceKindScores,
} from './source-diagnosis.types'
import type { ClassifiedBlockInput } from './structure-model.service'

/** A paragraph-like block shorter than this (in words) counts as a fragment. */
const SHORT_FRAGMENT_WORDS = 12

/**
 * Minimum winning score for a confident classification. Below this the source is
 * `unknown` and routes to the conservative source-grounded fallback.
 */
const CONFIDENCE_FLOOR = 0.34

/** Block types that carry running prose (used for length-distribution signals). */
const PROSE_TYPES = new Set(['paragraph', 'quote'])

/** Conversational filler / discourse markers typical of spoken transcripts. */
const TRANSCRIPT_MARKERS = [
  'um',
  'uh',
  'erm',
  'you know',
  'i mean',
  'kind of',
  'sort of',
  'like,',
  'okay so',
  'ok so',
  'so yeah',
  'yeah so',
  'right?',
  'gonna',
  'wanna',
  "let's",
  'alright',
  'basically',
]

/** First/second-person pronouns — a weaker spoken/lecture signal. */
const SPEECH_PRONOUNS = [
  ' i ',
  " i'",
  ' we ',
  " we'",
  ' you ',
  " you'",
  ' our ',
  ' us ',
]

/** Headings that mark the canonical sections of a research paper. */
const RESEARCH_HEADINGS = [
  'abstract',
  'introduction',
  'related work',
  'background',
  'methods',
  'methodology',
  'materials and methods',
  'results',
  'discussion',
  'conclusion',
  'conclusions',
  'references',
  'bibliography',
  'acknowledgements',
  'acknowledgments',
]

/** Headings/markers typical of technical documentation. */
const DOC_HEADINGS = [
  'installation',
  'getting started',
  'quick start',
  'quickstart',
  'usage',
  'configuration',
  'api',
  'api reference',
  'reference',
  'parameters',
  'options',
  'examples',
  'troubleshooting',
  'cli',
  'endpoints',
  'methods',
]

/** Hosts that strongly imply a structured encyclopedic / editorial web article. */
const ENCYCLOPEDIC_HOSTS = [
  'wikipedia.org',
  'britannica.com',
  'stanford.edu/entries', // plato.stanford.edu SEP entries
  'investopedia.com',
]

/** Hosts that strongly imply technical documentation. */
const DOC_HOSTS = [
  'readthedocs.io',
  'docs.',
  'developer.',
  'devdocs.io',
  'npmjs.com',
  'pkg.go.dev',
]

const lower = (s: string): string => s.toLowerCase()

const wordCount = (text: string): number =>
  text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length

/** Inline academic citation markers: [1], [12], (Smith et al., 2020), "et al.", DOIs. */
function countCitationMarkers(text: string): number {
  const t = lower(text)
  let n = 0
  n += (text.match(/\[\d{1,3}\]/g) ?? []).length // [1], [12]
  n += (
    text.match(
      /\(\s*[A-Z][A-Za-z]+(?:\s+(?:et al\.|and|&)\s+[A-Z][A-Za-z]+)?,?\s*\d{4}[a-z]?\s*\)/g,
    ) ?? []
  ).length // (Smith, 2020)
  n += (t.match(/et al\./g) ?? []).length
  n += (t.match(/\bdoi:|doi\.org|arxiv:/g) ?? []).length
  return n
}

/**
 * Derive the measurable detection signals from the blocks + metadata. Pure: the
 * same input always yields the same signals.
 */
export function computeDetectionSignals(
  blocks: ClassifiedBlockInput[],
  metadata: SourceDiagnosisMetadata = {},
): DetectionSignals {
  const total = blocks.length
  const blockTypeCounts: Record<string, number> = {}
  for (const b of blocks) {
    const key = lower(b.type)
    blockTypeCounts[key] = (blockTypeCounts[key] ?? 0) + 1
  }

  const headings = blockTypeCounts.heading ?? 0
  const lists = blockTypeCounts.list ?? 0
  const tables = blockTypeCounts.table ?? 0
  const code = blockTypeCounts.code ?? 0

  // Paragraph-length distribution (prose blocks only).
  const proseWordCounts = blocks
    .filter((b) => PROSE_TYPES.has(lower(b.type)))
    .map((b) => wordCount(b.text))
  const proseCount = proseWordCounts.length
  const totalProseWords = proseWordCounts.reduce((a, w) => a + w, 0)
  const avgParagraphWords = proseCount === 0 ? 0 : totalProseWords / proseCount
  const variance =
    proseCount === 0
      ? 0
      : proseWordCounts.reduce((a, w) => a + (w - avgParagraphWords) ** 2, 0) /
        proseCount
  const paragraphLengthCv =
    avgParagraphWords === 0 ? 0 : Math.sqrt(variance) / avgParagraphWords
  const shortFragmentRatio =
    proseCount === 0
      ? 0
      : proseWordCounts.filter((w) => w > 0 && w < SHORT_FRAGMENT_WORDS)
          .length / proseCount

  // Reference density: citation-classified blocks + inline citation markers,
  // normalised over the block count and clamped to [0, 1].
  let citationSignals = 0
  for (const b of blocks) {
    if (lower(b.classification).includes('citation')) citationSignals += 1
    citationSignals += countCitationMarkers(b.text)
  }
  const referenceDensity =
    total === 0 ? 0 : Math.min(1, citationSignals / total)

  // Transcript score: conversational markers + speech pronouns over prose, given
  // a (near-)headingless body. Spoken transcripts read as one long unbroken run.
  let markerHits = 0
  let pronounHits = 0
  for (const b of blocks) {
    if (!PROSE_TYPES.has(lower(b.type))) continue
    const t = ` ${lower(b.text)} `
    for (const m of TRANSCRIPT_MARKERS) if (t.includes(m)) markerHits += 1
    for (const p of SPEECH_PRONOUNS) if (t.includes(p)) pronounHits += 1
  }
  const markerComponent =
    proseCount === 0 ? 0 : Math.min(1, markerHits / proseCount)
  const pronounComponent =
    proseCount === 0 ? 0 : Math.min(1, pronounHits / (proseCount * 2))
  // Headings suppress the transcript signal — a transcript has almost none.
  const headinglessFactor = total === 0 ? 0 : 1 - Math.min(1, headings / total)
  const transcriptScore = Math.min(
    1,
    (markerComponent + pronounComponent) * headinglessFactor * 0.6,
  )

  return {
    totalBlocks: total,
    blockTypeCounts,
    headingDensity: total === 0 ? 0 : headings / total,
    tableListRatio: total === 0 ? 0 : (tables + lists) / total,
    codeRatio: total === 0 ? 0 : code / total,
    referenceDensity,
    transcriptScore,
    avgParagraphWords,
    paragraphLengthCv,
    shortFragmentRatio,
  }
}

/** Count blocks whose lower-cased heading/prose text matches any marker phrase. */
function headingMarkerHits(
  blocks: ClassifiedBlockInput[],
  markers: string[],
): number {
  let n = 0
  for (const b of blocks) {
    if (lower(b.type) !== 'heading') continue
    const h = lower(b.text).trim()
    if (markers.some((m) => h === m || h.startsWith(`${m} `) || h.includes(m)))
      n += 1
  }
  return n
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return lower(new URL(url).host)
  } catch {
    // Bare host or malformed URL — fall back to a loose token match.
    return lower(url)
  }
}

/**
 * Score every candidate source kind in [0, 1]. The scores are additive blends of
 * the relevant signals, each clamped, so overlapping evidence accumulates rather
 * than fighting. `unknown` is not scored — it is the floor fallback.
 */
export function scoreSourceKinds(
  signals: DetectionSignals,
  blocks: ClassifiedBlockInput[],
  metadata: SourceDiagnosisMetadata = {},
): SourceKindScores {
  const host = hostOf(metadata.url)
  const isPdf =
    metadata.sourceType === 'PDF' ||
    lower(metadata.fileName ?? '').endsWith('.pdf')

  // --- transcript_lesson ---------------------------------------------------
  // Strong speech patterns in a near-headingless body.
  const transcript_lesson = clamp01(
    signals.transcriptScore * (0.5 + 0.5 * (1 - signals.headingDensity)),
  )

  // --- research_paper ------------------------------------------------------
  const researchHeadingHits = headingMarkerHits(blocks, RESEARCH_HEADINGS)
  const researchHeadingComponent = Math.min(1, researchHeadingHits / 3)
  let research_paper = clamp01(
    0.6 * Math.min(1, signals.referenceDensity * 3) +
      0.4 * researchHeadingComponent,
  )
  if (isPdf && (researchHeadingHits > 0 || signals.referenceDensity > 0))
    research_paper = clamp01(research_paper + 0.15)

  // --- documentation -------------------------------------------------------
  // Code-heavy OR doc-structured (install/usage/api headings, option tables/lists).
  const docHeadingHits = headingMarkerHits(blocks, DOC_HEADINGS)
  let documentation = clamp01(
    0.45 * Math.min(1, signals.codeRatio * 3) +
      0.3 * Math.min(1, docHeadingHits / 2) +
      0.25 * Math.min(1, signals.headingDensity + signals.tableListRatio),
  )
  if (host && DOC_HOSTS.some((h) => host.includes(h)))
    documentation = clamp01(documentation + 0.25)

  // --- structured_web_article ----------------------------------------------
  // Headed prose with substantial paragraphs and little code/reference noise.
  // GATED on heading presence: a "structured" web article has a heading skeleton —
  // a headingless body is a transcript or raw notes, never this kind.
  const prosey =
    signals.avgParagraphWords >= 14 ? 1 : signals.avgParagraphWords / 14
  let structured_web_article =
    signals.headingDensity === 0
      ? 0
      : clamp01(
          0.4 * Math.min(1, signals.headingDensity * 3) +
            0.4 * prosey +
            0.2 * (1 - signals.shortFragmentRatio) -
            0.5 * signals.codeRatio -
            0.4 * signals.referenceDensity -
            0.3 * signals.tableListRatio,
        )
  if (host && ENCYCLOPEDIC_HOSTS.some((h) => host.includes(h)))
    structured_web_article = clamp01(structured_web_article + 0.3)

  // --- raw_notes -----------------------------------------------------------
  // Fragmentary: short prose, many bullets, no real heading structure.
  const raw_notes = clamp01(
    0.45 * signals.shortFragmentRatio +
      0.3 * Math.min(1, signals.tableListRatio * 1.5) +
      0.25 * (signals.avgParagraphWords < 12 ? 1 : 0) -
      0.4 * signals.headingDensity -
      0.3 * signals.transcriptScore,
  )

  return {
    transcript_lesson,
    structured_web_article,
    research_paper,
    documentation,
    raw_notes,
  }
}

/** Pick the winning kind, or `unknown` when the best score is below the floor. */
export function pickSourceKind(scores: SourceKindScores): {
  kind: SourceKind
  confidence: number
} {
  let best: Exclude<SourceKind, 'unknown'> | null = null
  let bestScore = -1
  // Deterministic tie-break: iterate a fixed priority order.
  const order: Exclude<SourceKind, 'unknown'>[] = [
    'transcript_lesson',
    'research_paper',
    'documentation',
    'structured_web_article',
    'raw_notes',
  ]
  for (const kind of order) {
    if (scores[kind] > bestScore) {
      bestScore = scores[kind]
      best = kind
    }
  }
  if (best === null || bestScore < CONFIDENCE_FLOOR)
    return { kind: 'unknown', confidence: 0 }
  return { kind: best, confidence: round2(bestScore) }
}

/**
 * Map a detected kind → the v3 article shape. `documentation` is the only branch
 * that consults the signals: a reference-style doc (table/list heavy, low code)
 * becomes a `reference_digest`; otherwise it is a `technical_walkthrough`.
 * `unknown` returns `null` — the conservative source-grounded fallback.
 */
export function selectArticleShape(
  kind: SourceKind,
  signals: DetectionSignals,
): SourceArticleShape | null {
  switch (kind) {
    case 'transcript_lesson':
      return 'lesson_article'
    case 'structured_web_article':
      return 'concept_explainer'
    case 'research_paper':
      return 'research_digest'
    case 'documentation':
      return signals.tableListRatio >= 0.34 && signals.codeRatio < 0.2
        ? 'reference_digest'
        : 'technical_walkthrough'
    case 'raw_notes':
      return 'structured_notes'
    default:
      return null
  }
}

/** Build the short human-readable rationale trail for the decision. */
function buildRationale(
  kind: SourceKind,
  signals: DetectionSignals,
  scores: SourceKindScores,
): string[] {
  const trail: string[] = [
    `${signals.totalBlocks} blocks; headingDensity=${round2(
      signals.headingDensity,
    )}, tableListRatio=${round2(signals.tableListRatio)}, codeRatio=${round2(
      signals.codeRatio,
    )}, referenceDensity=${round2(
      signals.referenceDensity,
    )}, transcriptScore=${round2(signals.transcriptScore)}`,
  ]
  if (kind === 'unknown') {
    const best = Math.max(...Object.values(scores))
    trail.push(
      `no kind reached the confidence floor (best=${round2(
        best,
      )} < ${CONFIDENCE_FLOOR}); using conservative source-grounded fallback`,
    )
  } else {
    trail.push(`detected ${kind} (score ${round2(scores[kind])})`)
  }
  return trail
}

/**
 * The full diagnosis the pipeline stores on the article generation job. Pure +
 * deterministic — the single entry point detection callers use.
 */
export function diagnoseSource(
  blocks: ClassifiedBlockInput[],
  metadata: SourceDiagnosisMetadata = {},
): SourceDiagnosis {
  const signals = computeDetectionSignals(blocks, metadata)
  const scores = scoreSourceKinds(signals, blocks, metadata)
  const { kind, confidence } = pickSourceKind(scores)
  const articleShape = selectArticleShape(kind, signals)
  return {
    sourceKind: kind,
    articleShape,
    confidence,
    signals,
    scores: roundScores(scores),
    rationale: buildRationale(kind, signals, scores),
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const round2 = (n: number): number => Math.round(n * 100) / 100
function roundScores(scores: SourceKindScores): SourceKindScores {
  return {
    transcript_lesson: round2(scores.transcript_lesson),
    structured_web_article: round2(scores.structured_web_article),
    research_paper: round2(scores.research_paper),
    documentation: round2(scores.documentation),
    raw_notes: round2(scores.raw_notes),
  }
}
