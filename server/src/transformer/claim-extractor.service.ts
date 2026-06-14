import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildClaimExtractionPrompt } from './claim-extractor.prompt'
import { completeJson } from './llm-json.util'
import { ClaimExtractionLlmSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  KeyClaim,
} from './transformer.types'

/**
 * Claim-extractor service (DET-352, the v3 claims layer). Runs AFTER the article
 * is rewritten and BEFORE the fidelity check, so the extracted claims ride on the
 * article the checker audits. LLM via `completeJson(ClaimExtractionLlmSchema)`,
 * then CODE guards (the model is never trusted for provenance or structure):
 *  - drop any claim whose `sourceBlockIds` are empty or reference unknown blocks.
 *  - DERIVE `articleSectionIds` in code from the article's own section→block map
 *    (which sections render the cited blocks); drop a claim that maps to no
 *    section — it has no home in the article body.
 *  - clamp `confidence` to 0–1; mint a stable id.
 * NEVER mutates the article body — the caller attaches the result to the
 * additive `keyClaims` field only.
 */
@Injectable()
export class ClaimExtractorService {
  constructor(private readonly ai: AiService) {}

  async extract(
    article: ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<KeyClaim[]> {
    const known = new Set(blocks.map((b) => b.id))
    // Map every source-block id to the article sections that render it. A claim's
    // article-section ids are derived from this map, never trusted from the LLM.
    const blockToSections = buildBlockToSectionsMap(article.sections)

    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))
    if (content.length === 0) return []

    // Top-level sections are context only (so the model groups related claims).
    const sectionContext = article.sections.map((s) => ({
      id: s.id,
      heading: s.heading,
      sourceBlockIds: s.sourceBlockIds,
    }))

    const { system, prompt } = buildClaimExtractionPrompt(
      article.title.text,
      sectionContext,
      content,
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: ClaimExtractionLlmSchema,
      maxTokens: 3000,
    })

    const claims: KeyClaim[] = []
    for (const c of raw.claims) {
      const validIds = c.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue
      const sectionIds = deriveSectionIds(validIds, blockToSections)
      if (sectionIds.length === 0) continue
      claims.push({
        id: randomUUID(),
        text: c.text,
        sourceBlockIds: validIds,
        articleSectionIds: sectionIds,
        claimType: c.claimType,
        confidence: clamp01(c.confidence),
      })
    }
    return claims
  }
}

/** Clamp a model-supplied confidence to the 0–1 range. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

/**
 * Build a map from a source-block id to the set of article section ids that
 * render it. A section "renders" a block when the block id appears in the
 * section's own `sourceBlockIds`, its `headingSourceBlockIds`, or any of its
 * typed `blocks[].sourceBlockIds`. Subsections map to their OWN id (claims land
 * on the most specific section that cites the block).
 */
function buildBlockToSectionsMap(
  sections: ArticleSectionV2[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (blockId: string, sectionId: string) => {
    const set = map.get(blockId) ?? new Set<string>()
    set.add(sectionId)
    map.set(blockId, set)
  }
  const walk = (s: ArticleSectionV2) => {
    for (const id of s.sourceBlockIds) add(id, s.id)
    for (const id of s.headingSourceBlockIds ?? []) add(id, s.id)
    for (const b of s.blocks) for (const id of b.sourceBlockIds) add(id, s.id)
    for (const sub of s.subsections ?? []) walk(sub)
  }
  for (const s of sections) walk(s)
  return map
}

/** The sorted union of section ids that render any of the claim's source blocks. */
function deriveSectionIds(
  sourceBlockIds: string[],
  blockToSections: Map<string, Set<string>>,
): string[] {
  const ids = new Set<string>()
  for (const blockId of sourceBlockIds) {
    for (const sectionId of blockToSections.get(blockId) ?? [])
      ids.add(sectionId)
  }
  return [...ids].sort()
}
