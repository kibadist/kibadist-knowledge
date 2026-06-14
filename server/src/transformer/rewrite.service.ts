import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { completeJson } from './llm-json.util'
import { buildRewritePrompt } from './rewrite.prompt'
import { RewriteSectionLlmSchema } from './rewrite.schemas'
import type {
  ArticleSectionV3,
  LearningOutline,
  OutlineSection,
  SourceSegment,
} from './rewrite.types'
import {
  finalizeSection,
  indexSegments,
  type RewriteContext,
} from './rewrite.util'

/** Budget one section's rewrite generously — prose for several blocks plus traces. */
const MAX_TOKENS = 4000

/**
 * Source-grounded editorial rewrite service (DET-349). Consumes the approved
 * `LearningOutline` + the conceptual `SourceSegment[]` and returns full
 * `ArticleSectionV3[]`: each outline section is rewritten — in ONE LLM call per
 * top-level section, scoped to only that section's source blocks — into polished
 * educational prose that preserves source meaning and per-paragraph traceability.
 *
 * The model is UNTRUSTED. It replies in the lenient `RewriteSectionLlm` wire shape;
 * the pure `finalizeSection` helper then does the strict work in code:
 *  - prunes every `sourceBlockIds` to the section's real block universe and DROPS
 *    any paragraph/callout/table left unsupported (unsupported claims omitted
 *    before fidelity review);
 *  - drops AI-invented callouts (grounded:false) and analogies not grounded in an
 *    `analogy`-role block;
 *  - normalizes each `SourceTrace` (clamps confidence, floors fidelity risk);
 *  - mints deterministic anchor ids and derives each section's `sourceBlockIds`.
 * A section that empties out is dropped rather than emitted as a bare heading.
 *
 * Because the section call is scoped to its own segments, the model can only cite
 * ids it was shown; `finalizeSection` re-checks them regardless.
 */
@Injectable()
export class RewriteService {
  constructor(private readonly ai: AiService) {}

  async rewrite(
    outline: LearningOutline,
    segments: SourceSegment[],
  ): Promise<ArticleSectionV3[]> {
    const segmentById = new Map(segments.map((s) => [s.id, s]))
    const sections: ArticleSectionV3[] = []

    for (let i = 0; i < outline.sections.length; i++) {
      const section = outline.sections[i]
      const rewritten = await this.rewriteSection(
        outline,
        section,
        `s${i}`,
        segmentById,
      )
      if (rewritten) sections.push(rewritten)
    }

    return sections
  }

  /** Rewrite one outline section (subtree) and finalize it; null when it empties. */
  private async rewriteSection(
    outline: LearningOutline,
    section: OutlineSection,
    sectionId: string,
    segmentById: Map<string, SourceSegment>,
  ): Promise<ArticleSectionV3 | null> {
    const segments = this.collectSegments(section, segmentById)
    // A section whose segments all went missing has nothing to ground prose in.
    if (segments.length === 0) return null

    const { known, roleByBlockId } = indexSegments(segments)
    const { system, prompt } = buildRewritePrompt(outline, section, segmentById)

    const llm = await completeJson(this.ai, {
      system,
      prompt,
      schema: RewriteSectionLlmSchema,
      maxTokens: MAX_TOKENS,
    })

    const ctx: RewriteContext = { sectionId, known, roleByBlockId }
    return finalizeSection(llm, ctx)
  }

  /** All segments backing a section and its subsections (one level), in order. */
  private collectSegments(
    section: OutlineSection,
    segmentById: Map<string, SourceSegment>,
  ): SourceSegment[] {
    const ids = [
      ...section.segmentIds,
      ...(section.subsections ?? []).flatMap((sub) => sub.segmentIds),
    ]
    const out: SourceSegment[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      const segment = segmentById.get(id)
      if (segment) {
        seen.add(id)
        out.push(segment)
      }
    }
    return out
  }
}
