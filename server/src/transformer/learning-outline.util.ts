/**
 * Pure helpers for the learning-outline stage (DET-348). ZERO AI, fully
 * unit-tested. Three jobs:
 *  1. DERIVE the source kind + learning shape deterministically from the classified
 *     blocks (so the stage has sensible defaults without trusting the LLM).
 *  2. ENFORCE the source-notes rule: source furniture (references / bibliography /
 *     external links / further reading) is planned into source notes unless a real
 *     content section directly needs it — never kept as a body section.
 *  3. AUDIT reading-order moves by reusing the same coverage util the reshaping
 *     plan + fidelity checker use, so "all section reorderings are audited".
 */

import type {
  LearningArticleShape,
  OutlineSection,
  ReorderAuditEntry,
  SourceKind,
  SourceNote,
  SourceNotePlan,
  SourceSegment,
} from './learning-outline.types'
import { SOURCE_NOTE_SEGMENT_KINDS } from './learning-outline.types'
import {
  auditPlanReorderCoverage,
  type PlanReorderSection,
  type ReorderSourceBlock,
} from './reorder-audit.util'
import type { SegmentBlock } from './source-segments.util'

/** Upper-cased classification set for a block list (UNCERTAIN for blanks). */
function classSet(blocks: SegmentBlock[]): Set<string> {
  return new Set(
    blocks.map((b) => (b.classification || 'UNCERTAIN').toUpperCase()),
  )
}

/**
 * Derive the source KIND from the classified blocks (DET-348). Deterministic
 * heuristics over block types + classifications — never an LLM:
 *  - method + citation matter → a research paper;
 *  - method-heavy without citations → a tutorial/how-to;
 *  - has headings + definitions → encyclopedic;
 *  - no headings at all → a transcript (raw speech);
 *  - has headings otherwise → a general article.
 */
export function deriveSourceKind(blocks: SegmentBlock[]): SourceKind {
  if (blocks.length === 0) return 'unknown'
  const types = new Set(blocks.map((b) => (b.type || '').toUpperCase()))
  const classes = classSet(blocks)
  const hasHeadings = types.has('HEADING')
  const hasMethod = classes.has('METHOD')
  const hasCitations = classes.has('CITATION')
  const hasDefinition = classes.has('DEFINITION')

  if (hasMethod && hasCitations) return 'research_paper'
  if (hasMethod) return 'tutorial'
  if (hasHeadings && hasDefinition) return 'encyclopedia'
  if (!hasHeadings) return 'transcript'
  if (hasHeadings) return 'article'
  return 'unknown'
}

/**
 * Derive the LEARNING shape (DET-348) from the source kind, the reshaping plan's
 * genre shape (optional), and the blocks. The learning shape names the TEACHING
 * skeleton the outline organises around; it is a default the LLM may refine, then
 * the stage keeps whatever the (validated) outline returns.
 */
export function deriveLearningShape(
  sourceKind: SourceKind,
  genreShape?: string,
): LearningArticleShape {
  switch (sourceKind) {
    case 'transcript':
    case 'tutorial':
      return 'lesson_article'
    case 'research_paper':
      return 'research_digest'
    case 'encyclopedia':
    case 'reference':
      return 'concept_explainer'
    default:
      break
  }
  // Fall back to the genre shape for a general article.
  switch (genreShape) {
    case 'argument':
    case 'report':
      return 'research_digest'
    case 'explainer':
    case 'reference':
      return 'concept_explainer'
    case 'procedure':
    case 'narrative':
      return 'lesson_article'
    default:
      return 'general'
  }
}

/**
 * The teaching role sequence each learning shape organises around (DET-348). Used
 * by the prompt to steer the LLM and exported so tests can assert the contract.
 * These are GUIDANCE, never a hard schema — a source that lacks a misconception
 * simply omits that section.
 */
export const SHAPE_ROLE_SEQUENCE: Record<LearningArticleShape, string[]> = {
  lesson_article: ['introduction', 'concept', 'example', 'practice', 'summary'],
  concept_explainer: [
    'definition',
    'boundaries',
    'types',
    'mechanism',
    'example',
    'application',
    'misconception',
  ],
  research_digest: [
    'question',
    'method',
    'evidence',
    'results',
    'limitations',
    'implications',
  ],
  general: ['introduction', 'concept', 'example', 'summary'],
}

/** A surviving section + the demoted-notes + warnings from source-notes enforcement. */
export interface SourceNotesResult {
  sections: OutlineSection[]
  sourceNotesPlan: SourceNotePlan
  warnings: string[]
}

/**
 * Enforce the source-notes rule (DET-348). Source-note segments (references /
 * bibliography / external links / further reading / citations / see-also) are
 * planned into `sourceNotesPlan` UNLESS a real content section directly needs them:
 *  - any section whose cited segments are ALL source-note segments is DEMOTED out
 *    of the body and folded into the notes (it was a source-layout clone, not
 *    teaching content);
 *  - any source-note segment not cited by a surviving content section is added to
 *    the notes so it is never silently dropped nor left as a body heading;
 *  - a source-note segment a surviving content section DOES cite is "directly
 *    needed" and left in place.
 * The LLM's own `sourceNotesPlan` notes are kept and merged (deduped by segment).
 */
export function enforceSourceNotes(
  sections: OutlineSection[],
  segments: SourceSegment[],
  llmNotes: SourceNote[] = [],
): SourceNotesResult {
  const segById = new Map(segments.map((s) => [s.id, s]))
  const noteSegmentIds = new Set(
    segments
      .filter((s) => SOURCE_NOTE_SEGMENT_KINDS.has(s.kind))
      .map((s) => s.id),
  )
  const warnings: string[] = []

  // 1. Partition sections: keep genuine content, demote pure source-note sections.
  const kept: OutlineSection[] = []
  const demotedSegmentIds = new Set<string>()
  for (const section of sections) {
    const cited = section.sourceSegmentIds.filter((id) => segById.has(id))
    const isPureSourceNote =
      cited.length > 0 && cited.every((id) => noteSegmentIds.has(id))
    if (isPureSourceNote) {
      for (const id of cited) demotedSegmentIds.add(id)
      warnings.push(
        `Demoted section "${section.heading}" to source notes: it only cites source furniture (${cited
          .map((id) => segById.get(id)?.kind)
          .join(', ')}), not teaching content.`,
      )
      continue
    }
    kept.push(section)
  }

  // 2. Which source-note segments are still "directly needed" by a kept section?
  const neededByContent = new Set<string>()
  for (const section of kept) {
    for (const id of section.sourceSegmentIds) {
      if (noteSegmentIds.has(id)) neededByContent.add(id)
    }
  }

  // 3. Build the notes: every source-note segment not needed by content becomes a
  //    note (plus the demoted ones), merged with the LLM's own notes by segment.
  const notesBySegment = new Map<string, SourceNote>()
  const addSegmentNote = (seg: SourceSegment, reason: string) => {
    if (notesBySegment.has(seg.id)) return
    notesBySegment.set(seg.id, {
      kind: seg.kind,
      sourceBlockIds: [...seg.blockIds],
      sourceSegmentIds: [seg.id],
      reason,
    })
  }

  for (const seg of segments) {
    if (!noteSegmentIds.has(seg.id)) continue
    if (neededByContent.has(seg.id)) continue
    addSegmentNote(
      seg,
      demotedSegmentIds.has(seg.id)
        ? `${seg.headingText ?? seg.kind}: demoted from a body section to source notes`
        : `${seg.headingText ?? seg.kind}: reference matter, not teaching content`,
    )
  }

  // Merge any LLM-supplied notes that reference real segments and aren't dupes.
  const llmExtra = llmNotes.filter(
    (n) => !n.sourceSegmentIds.some((id) => notesBySegment.has(id)),
  )

  return {
    sections: kept,
    sourceNotesPlan: { notes: [...notesBySegment.values(), ...llmExtra] },
    warnings,
  }
}

/**
 * Audit the outline's reading-order moves (DET-348). Reuses the same coverage util
 * the reshaping plan + fidelity checker use: a section "moves" when its reading
 * order differs from the min-source-position of its cited blocks, and every move
 * must be recorded in `reorderings`. Returns a warning per unaudited move.
 */
export function auditOutlineReorder(
  sections: OutlineSection[],
  blocks: ReorderSourceBlock[],
  reorderings: ReorderAuditEntry[],
): string[] {
  const planSections: PlanReorderSection[] = sections.map((s) => ({
    heading: s.heading,
    sourceBlockIds: s.sourceBlockIds,
  }))
  const coverage = auditPlanReorderCoverage(
    { sections: planSections, reorderings },
    blocks,
  )
  return coverage.unaudited.map(
    (m) =>
      `unaudited reorder: section "${m.sectionId}" moves from source position ${m.sourceIndex} to reading position ${m.readingIndex} (anchor block ${m.anchorBlockId || 'unknown'}) but is not recorded in reorderings[]. Record the move or restore source order.`,
  )
}
