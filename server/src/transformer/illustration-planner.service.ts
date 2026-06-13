import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ILLUSTRATION_QUALITY_WARNING } from './illustration-gate.util'
import { buildIllustrationPrompt } from './illustration-planner.prompt'
import { completeJson } from './llm-json.util'
import {
  type IllustrationPlan,
  IllustrationPlanLlmSchema,
  type IllustrationSuggestion,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Quality context for a plan (DET-360). `qualityReady` is false when the article
 * is BLOCKED or its fidelity gate rejected; every suggestion is then marked
 * ineligible and carries `qualityWarning`. Defaults to ready so the on-demand
 * path keeps its prior behaviour unless a caller passes a gate.
 */
export interface IllustrationPlanOptions {
  qualityReady?: boolean
  qualityWarning?: string
}

/** A source-grounded article section: its id and every block id it cites. */
interface SectionGrounding {
  id: string
  blockIds: Set<string>
}

/**
 * Illustration planner (DET-259, step 10, on demand only). LLM via
 * `completeJson(IllustrationPlanLlmSchema)`, then CODE guards:
 *  - drop any suggestion whose sourceBlockIds is empty or references unknown
 *    blocks ("cannot be created without sourceBlockIds").
 *  - resolve each suggestion's article `sectionIds` from the sections whose
 *    blocks it cites; a source_based_diagram that grounds in NO section is
 *    dropped (DET-360: a diagram spec must reference source blocks AND sections).
 *  - force fidelityRisk='high' for source_based_diagram unless EVERY cited block
 *    is classified METHOD (conservative).
 *  - gate on article quality (DET-360): when the article is not ready, every
 *    suggestion is marked `eligible: false` with a `qualityWarning` so it stays a
 *    draft and is never auto-rendered.
 *  - mint a stable id and force approval='pending' for every suggestion.
 * No image generation anywhere.
 */
@Injectable()
export class IllustrationPlannerService {
  constructor(private readonly ai: AiService) {}

  async plan(
    article: SourcePreservingArticle | ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
    options: IllustrationPlanOptions = {},
  ): Promise<IllustrationPlan> {
    const qualityReady = options.qualityReady ?? true
    const qualityWarning = qualityReady
      ? undefined
      : (options.qualityWarning ?? ILLUSTRATION_QUALITY_WARNING)
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const sections = collectSectionGrounding(article)
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildIllustrationPrompt(
      JSON.stringify(article),
      content,
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: IllustrationPlanLlmSchema,
      maxTokens: 3000,
    })

    const suggestions: IllustrationSuggestion[] = []
    for (const s of raw.suggestions) {
      const validIds = s.sourceBlockIds.filter((id) => byId.has(id))
      // DET-259: a suggestion without valid source grounding is dropped.
      if (validIds.length === 0) continue

      // DET-360: anchor the suggestion to the article sections whose blocks it
      // cites — derived in code, never trusted from the model.
      const sectionIds = sections
        .filter((sec) => validIds.some((id) => sec.blockIds.has(id)))
        .map((sec) => sec.id)

      let fidelityRisk = s.fidelityRisk
      if (s.illustrationType === 'source_based_diagram') {
        // DET-360: a diagram spec must reference article sections; one that ties
        // to no section is not structurally grounded, so drop it.
        if (sectionIds.length === 0) continue
        const allMethod = validIds.every(
          (id) => byId.get(id)?.classification === 'METHOD',
        )
        // Conservative: a diagram is high risk unless every cited block is METHOD.
        if (!allMethod) fidelityRisk = 'high'
      }

      suggestions.push({
        id: randomUUID(),
        illustrationType: s.illustrationType,
        purpose: s.purpose,
        visualDescription: s.visualDescription,
        caption: s.caption,
        fidelityRisk,
        reason: s.reason,
        sourceBlockIds: validIds,
        ...(sectionIds.length ? { sectionIds } : {}),
        eligible: qualityReady,
        ...(qualityWarning ? { qualityWarning } : {}),
        approval: 'pending',
      })
    }

    return { suggestions }
  }
}

/**
 * Flatten an article (v1 or v2) into per-section source grounding. Only v2
 * sections carry an `id`, so v1 articles yield no sections (covers/decorative
 * suggestions simply get no `sectionIds`, and a diagram — which needs a section —
 * is dropped). Walks one level of subsections.
 */
function collectSectionGrounding(
  article: SourcePreservingArticle | ArticleJsonV2,
): SectionGrounding[] {
  const out: SectionGrounding[] = []
  const visit = (section: ArticleSectionV2) => {
    const blockIds = new Set<string>(section.sourceBlockIds ?? [])
    for (const block of section.blocks ?? []) {
      for (const id of block.sourceBlockIds ?? []) blockIds.add(id)
    }
    out.push({ id: section.id, blockIds })
    for (const sub of section.subsections ?? []) visit(sub)
  }
  for (const section of article.sections ?? []) {
    // v1 sections lack an `id`; skip them (no resolvable section anchor).
    if (typeof (section as Partial<ArticleSectionV2>).id === 'string') {
      visit(section as ArticleSectionV2)
    }
  }
  return out
}
