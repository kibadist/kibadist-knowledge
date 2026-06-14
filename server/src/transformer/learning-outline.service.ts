import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildLearningOutlinePrompt } from './learning-outline.prompt'
import type {
  LearningArticleShape,
  LearningOutline,
  OutlineSection,
  SourceKind,
  SourceNote,
  SourceSegment,
} from './learning-outline.types'
import {
  auditOutlineReorder,
  enforceSourceNotes,
} from './learning-outline.util'
import { completeJson } from './llm-json.util'
import { type LearningOutlineLlm, LearningOutlineLlmSchema } from './schemas'
import { buildSourceSegments } from './source-segments.util'
import type { ClassifiedBlockInput } from './structure-model.service'

/** Everything the outline stage consumes (DET-348). */
export interface LearningOutlineInput {
  sourceKind: SourceKind
  articleShape: LearningArticleShape
  blocks: ClassifiedBlockInput[]
  /** Pre-derived segments; rebuilt from `blocks` when omitted. */
  segments?: SourceSegment[]
}

/**
 * Learning-outline service (DET-348, pipeline step between the reshaping plan and
 * the rewrite). One LLM call via `completeJson(LearningOutlineLlmSchema)`, then
 * CODE post-processing that the LLM is never trusted to have done:
 *  - PRUNE every cited block/segment id the source can't back; drop a section left
 *    with no real provenance (a single hallucinated id never FAILs the article).
 *    When every section is pruned away there is nothing to teach → throw (FAILED),
 *    exactly like the reshaping plan's `sections.min(1)`.
 *  - SOURCE NOTES (acceptance): demote any source-furniture section to source notes
 *    and plan every references/bibliography/external-links segment into notes unless
 *    a content section directly needs it (`enforceSourceNotes`).
 *  - AUDIT every reading-order move (`auditOutlineReorder`) — an unrecorded move
 *    becomes a warning, mirroring the plan + fidelity checker.
 *  - STAMP `sourceKind` / `articleShape` in code (derived + passed in, never
 *    prompt-trusted).
 */
@Injectable()
export class LearningOutlineService {
  constructor(private readonly ai: AiService) {}

  async build(input: LearningOutlineInput): Promise<LearningOutline> {
    const { sourceKind, articleShape, blocks } = input
    const segments = input.segments ?? buildSourceSegments(blocks)

    const knownBlocks = new Set(blocks.map((b) => b.id))
    const knownSegments = new Set(segments.map((s) => s.id))

    // The prompt teaches from the kept (non-removable) content blocks; segments
    // still reference everything so furniture is visible for demotion.
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildLearningOutlinePrompt(
      sourceKind,
      articleShape,
      segments,
      content,
    )
    const llm = await completeJson(this.ai, {
      system,
      prompt,
      schema: LearningOutlineLlmSchema,
      maxTokens: 4000,
    })

    // --- Prune to real ids, drop empty sections -----------------------------
    const prunedSections = pruneSections(
      llm.sections,
      knownBlocks,
      knownSegments,
    )
    if (prunedSections.length === 0) {
      throw new Error(
        'Learning outline has no section with a traceable source reference',
      )
    }

    // --- Source-notes enforcement (acceptance) ------------------------------
    const llmNotes = pruneNotes(
      llm.sourceNotesPlan.notes,
      knownBlocks,
      knownSegments,
    )
    const notesResult = enforceSourceNotes(prunedSections, segments, llmNotes)

    // --- Reorder audit ------------------------------------------------------
    const reorderWarnings = auditOutlineReorder(
      notesResult.sections,
      blocks.map((b) => ({ id: b.id })),
      llm.reorderings,
    )

    // --- Learning path: keep only steps that still point at a real section --
    const survivingHeadings = new Set(
      notesResult.sections.map((s) => s.heading),
    )
    const learningPath = llm.learningPath
      .map((item) => ({
        ...item,
        sectionHeadings: item.sectionHeadings.filter((h) =>
          survivingHeadings.has(h),
        ),
      }))
      .filter((item) => item.sectionHeadings.length > 0)

    // --- Callouts + tables: prune to real ids, drop empties -----------------
    const calloutPlan = llm.calloutPlan
      .map((c) => ({
        ...c,
        sourceBlockIds: c.sourceBlockIds.filter((id) => knownBlocks.has(id)),
      }))
      .filter((c) => c.sourceBlockIds.length > 0)
    const tablePlan = llm.tablePlan
      .map((t) => ({
        ...t,
        sourceBlockIds: t.sourceBlockIds.filter((id) => knownBlocks.has(id)),
      }))
      .filter((t) => t.sourceBlockIds.length > 0)

    return {
      sourceKind,
      articleShape,
      title: llm.title,
      ...(llm.dek ? { dek: llm.dek } : {}),
      learningPath,
      sections: notesResult.sections,
      sourceNotesPlan: notesResult.sourceNotesPlan,
      calloutPlan,
      tablePlan,
      reorderings: llm.reorderings,
      warnings: [...llm.warnings, ...notesResult.warnings, ...reorderWarnings],
    }
  }
}

/**
 * Prune each section's cited block/segment ids to ones the source actually
 * contains, and DROP a section left with no real source block (its provenance was
 * entirely hallucinated). Segment ids are best-effort provenance, so a section is
 * only dropped when its BLOCK ids are all invalid.
 */
function pruneSections(
  sections: LearningOutlineLlm['sections'],
  knownBlocks: ReadonlySet<string>,
  knownSegments: ReadonlySet<string>,
): OutlineSection[] {
  const out: OutlineSection[] = []
  for (const s of sections) {
    const sourceBlockIds = s.sourceBlockIds.filter((id) => knownBlocks.has(id))
    if (sourceBlockIds.length === 0) continue
    const sourceSegmentIds = s.sourceSegmentIds.filter((id) =>
      knownSegments.has(id),
    )
    const section: OutlineSection = {
      heading: s.heading,
      headingSource: s.headingSource,
      ...(s.headingInferenceReason
        ? { headingInferenceReason: s.headingInferenceReason }
        : {}),
      sectionRole: s.sectionRole,
      sourceSegmentIds,
      sourceBlockIds,
      conceptFocus: s.conceptFocus,
      requiredClaims: s.requiredClaims,
      targetReaderOutcome: s.targetReaderOutcome,
    }
    out.push(section)
  }
  return out
}

/** Prune LLM-supplied source notes to real ids; drop a note left with no blocks. */
function pruneNotes(
  notes: LearningOutlineLlm['sourceNotesPlan']['notes'],
  knownBlocks: ReadonlySet<string>,
  knownSegments: ReadonlySet<string>,
): SourceNote[] {
  const out: SourceNote[] = []
  for (const n of notes) {
    const sourceBlockIds = n.sourceBlockIds.filter((id) => knownBlocks.has(id))
    if (sourceBlockIds.length === 0) continue
    out.push({
      kind: n.kind,
      sourceBlockIds,
      sourceSegmentIds: n.sourceSegmentIds.filter((id) =>
        knownSegments.has(id),
      ),
      reason: n.reason,
    })
  }
  return out
}
