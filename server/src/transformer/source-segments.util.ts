/**
 * Source segmentation for the learning-outline stage (DET-348). Pure,
 * deterministic, ZERO AI. Groups the classified source blocks into contiguous
 * `SourceSegment`s — the semantic chunks the outline plans over — and labels each
 * segment's `kind` so the outline can demote source furniture (References,
 * Bibliography, External links) to source notes instead of keeping them as body
 * headings.
 *
 * THE MODEL. A new segment opens at every HEADING block (and at the very start).
 * Each segment owns the heading plus the run of blocks until the next heading. A
 * headingless source (a raw transcript) yields a single content segment, which is
 * exactly what we want: the outline then teaches across it rather than emitting one
 * isolated heading per sentence.
 *
 * KIND DETECTION. A segment is source FURNITURE when its heading text matches a
 * known furniture label (references/bibliography/external links/further reading/see
 * also/citations) OR its content is dominated by CITATION-class blocks. Otherwise
 * it is `content`. Pure heuristics on the heading + classifications — never an LLM.
 */

import type { SegmentKind, SourceSegment } from './learning-outline.types'
import type { ClassifiedBlockInput } from './structure-model.service'

/** A block as the segmenter consumes it (the M2/M3 `ClassifiedBlockInput`). */
export type SegmentBlock = Pick<
  ClassifiedBlockInput,
  'id' | 'type' | 'classification' | 'text' | 'headingLevel'
>

/**
 * Furniture heading labels → segment kind. Matched case-insensitively against the
 * trimmed heading text (optionally with a trailing "[edit]"/section number stripped).
 * Order matters only for readability; each regex is anchored to the whole label.
 */
const FURNITURE_HEADINGS: { kind: SegmentKind; pattern: RegExp }[] = [
  { kind: 'references', pattern: /^references?$/i },
  { kind: 'bibliography', pattern: /^(bibliography|works cited|sources)$/i },
  {
    kind: 'externalLinks',
    pattern: /^(external links?|links?)$/i,
  },
  {
    kind: 'furtherReading',
    pattern: /^(further reading|read more|recommended reading)$/i,
  },
  { kind: 'citations', pattern: /^(citations?|footnotes?|notes)$/i },
  { kind: 'seeAlso', pattern: /^see also$/i },
]

/** Strip a trailing "[edit]" marker and surrounding whitespace from a heading. */
function normalizeHeading(text: string): string {
  return text
    .replace(/\[edit\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Classify a heading's furniture kind, or undefined when it is real content. */
function furnitureKindForHeading(text: string): SegmentKind | undefined {
  const normalized = normalizeHeading(text)
  for (const { kind, pattern } of FURNITURE_HEADINGS) {
    if (pattern.test(normalized)) return kind
  }
  return undefined
}

/** The most common classification among a run of blocks (ties → first seen). */
function dominantClassification(blocks: SegmentBlock[]): string {
  const counts = new Map<string, number>()
  for (const b of blocks) {
    const c = b.classification || 'UNCERTAIN'
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = 'UNCERTAIN'
  let bestCount = -1
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

/**
 * Decide a segment's kind from its heading + body blocks. A furniture heading wins
 * outright. Otherwise, a segment whose non-heading blocks are MAJORITY CITATION
 * class is treated as `citations` (a reference list under a generic/absent
 * heading); a segment that is entirely FOOTER/NOISE class is `footer`/`noise`.
 * Everything else is `content`.
 */
function segmentKind(
  headingText: string | undefined,
  bodyBlocks: SegmentBlock[],
): SegmentKind {
  if (headingText) {
    const byHeading = furnitureKindForHeading(headingText)
    if (byHeading) return byHeading
  }
  if (bodyBlocks.length === 0) return 'content'

  const classes = bodyBlocks.map((b) => (b.classification || '').toUpperCase())
  const all = (pred: (c: string) => boolean) => classes.every(pred)
  const majority = (pred: (c: string) => boolean) =>
    classes.filter(pred).length * 2 > classes.length

  if (all((c) => c === 'NOISE')) return 'noise'
  if (all((c) => c === 'FOOTER')) return 'footer'
  if (majority((c) => c === 'CITATION')) return 'citations'
  return 'content'
}

/**
 * Build the ordered `SourceSegment[]` for a source (DET-348). A new segment opens
 * at each HEADING block; a leading run with no heading forms an initial content
 * segment. Removable/noise blocks are KEPT in their segment (the outline decides
 * what to demote/drop) but contribute to the kind heuristic. Returns [] for no
 * blocks.
 */
export function buildSourceSegments(blocks: SegmentBlock[]): SourceSegment[] {
  if (blocks.length === 0) return []

  // Group blocks into runs, splitting before each HEADING.
  type Run = { heading?: SegmentBlock; body: SegmentBlock[] }
  const runs: Run[] = []
  let current: Run | undefined

  for (const block of blocks) {
    const isHeading = (block.type || '').toUpperCase() === 'HEADING'
    if (isHeading) {
      current = { heading: block, body: [] }
      runs.push(current)
      continue
    }
    if (!current) {
      current = { body: [] }
      runs.push(current)
    }
    current.body.push(block)
  }

  return runs.map((run, i) => {
    const headingText = run.heading
      ? normalizeHeading(run.heading.text)
      : undefined
    const blockIds = [
      ...(run.heading ? [run.heading.id] : []),
      ...run.body.map((b) => b.id),
    ]
    const segment: SourceSegment = {
      id: `seg${i + 1}`,
      kind: segmentKind(headingText, run.body),
      blockIds,
      dominantClassification: dominantClassification(
        run.heading ? [run.heading, ...run.body] : run.body,
      ),
    }
    if (run.heading) {
      segment.headingBlockId = run.heading.id
      if (headingText) segment.headingText = headingText
      if (run.heading.headingLevel != null) {
        segment.headingLevel = run.heading.headingLevel
      }
    }
    return segment
  })
}
