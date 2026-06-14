import { randomUUID } from 'node:crypto'

import { Injectable, NotFoundException } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import {
  buildBlockToSectionIndex,
  dedupeArticleConceptCandidates,
  normalizeConceptName,
  sectionIdsForBlocks,
  toRelationshipType,
} from './concept-candidate.util'
import { buildArticleConceptExtractionPrompt } from './learning-extraction.prompt'
import {
  buildConceptCandidatesPrompt,
  buildLearningLayerPrompt,
} from './learning-layer.prompt'
import { completeJson } from './llm-json.util'
import {
  type ArticleConceptCandidate,
  ArticleConceptExtractionLlmSchema,
  ConceptCandidatesLlmSchema,
  type ConceptRelationshipCandidate,
  type LearningConcept,
  type LearningConceptCandidate,
  type LearningLayer,
  LearningLayerLlmSchema,
  type RetrievalPrompt,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  KeyClaim,
} from './transformer.types'

/**
 * Learning-layer service (DET-258, step 11, on demand only). LLM via
 * `completeJson(LearningLayerLlmSchema)`, then CODE guards:
 *  - drop any concept/prompt without valid sourceBlockIds (grounding required).
 *  - mint stable ids; force every validationStatus to 'pending'.
 * NEVER writes into articleJson — the caller stores the result only in the
 * dedicated `learningLayer` column.
 *
 * Also hosts per-section concept-extraction candidates (DET-283,
 * `extractCandidatesForSection`): scoped to ONE v2 section's source blocks,
 * grounded, code-guarded, and returned as proposals — never library Concepts.
 */
@Injectable()
export class LearningLayerService {
  constructor(private readonly ai: AiService) {}

  /**
   * Build the learning layer (concepts + retrieval prompts). `keyClaims` (DET-352)
   * are optional retrieval-prompt SEEDS: the article's important claims, passed as
   * advisory hints so the generated self-test prompts target them. They never widen
   * grounding — every prompt/concept is still code-dropped unless it cites a real
   * source block.
   */
  async build(
    blocks: ClassifiedBlockInput[],
    keyClaims: KeyClaim[] = [],
  ): Promise<LearningLayer> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildLearningLayerPrompt(content, keyClaims)
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: LearningLayerLlmSchema,
      maxTokens: 3000,
    })

    const concepts: LearningConcept[] = []
    for (const c of raw.concepts) {
      const validIds = c.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue
      concepts.push({
        id: randomUUID(),
        label: c.label,
        definition: c.definition,
        sourceBlockIds: validIds,
        validationStatus: 'pending',
      })
    }

    const retrievalPrompts: RetrievalPrompt[] = []
    for (const p of raw.retrievalPrompts) {
      const validIds = p.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue
      retrievalPrompts.push({
        id: randomUUID(),
        prompt: p.prompt,
        sourceBlockIds: validIds,
      })
    }

    return { concepts, retrievalPrompts }
  }

  /**
   * Extract concept CANDIDATES for one section of a v2 article (DET-283).
   *
   * Scoping. The section is located by id, searching subsections too; a candidate
   * extracted from a subsection attaches to THAT subsection's id. The block subset
   * passed to the LLM is the union of the section's `blocks[].sourceBlockIds` plus
   * its own + heading source ids, intersected with the article's real source
   * blocks (pinned `blocksVersion`). An unknown sectionId throws NotFound.
   *
   * Metadata enrichment. The section's `sectionRole`, the typed block types of the
   * cited blocks, and any top-level keyTerms/sourceExamples/caveats overlapping
   * the section's block ids are passed to the prompt as HINTS only.
   *
   * Code guards (post-LLM, never prompt-trusted). Candidates with empty/unknown
   * `sourceBlockIds` are dropped; ids are minted; `aiAssisted` is forced true and
   * `validationStatus` 'pending'; `sectionId` + `sectionRole`/`blockType` metadata
   * are stamped IN CODE from the actual section.
   */
  async extractCandidatesForSection(
    article: ArticleJsonV2,
    sectionId: string,
    blocks: ClassifiedBlockInput[],
  ): Promise<LearningConceptCandidate[]> {
    const section = findSection(article.sections, sectionId)
    if (!section) {
      throw new NotFoundException('Section not found')
    }

    const knownById = new Map(blocks.map((b) => [b.id, b]))
    // Union of every source-block id the section cites: its own ids, its heading
    // provenance ids, and each block's ids — intersected with real blocks.
    const sectionBlockIds = new Set<string>()
    for (const id of section.sourceBlockIds) sectionBlockIds.add(id)
    for (const id of section.headingSourceBlockIds ?? [])
      sectionBlockIds.add(id)
    for (const b of section.blocks)
      for (const id of b.sourceBlockIds) sectionBlockIds.add(id)
    const scopedIds = [...sectionBlockIds].filter((id) => knownById.has(id))
    const scoped = scopedIds.map((id) => knownById.get(id)!)

    if (scoped.length === 0) {
      // Nothing real to ground candidates in — no extraction, no LLM call.
      return []
    }

    const scopedIdSet = new Set(scopedIds)
    // Typed block types of the cited blocks — a hint that improves labelling.
    const blockTypes = [...new Set(section.blocks.map((b) => b.type))]
    // Top-level end-matter overlapping the section's block ids (hints only).
    const overlaps = (ids: string[]) => ids.some((id) => scopedIdSet.has(id))
    const keyTerms = article.keyTerms
      .filter((t) => overlaps(t.sourceBlockIds))
      .map((t) => t.term)
    const sourceExamples = article.sourceExamples
      .filter((e) => overlaps(e.sourceBlockIds))
      .map((e) => e.text)
    const caveats = article.caveats
      .filter((c) => overlaps(c.sourceBlockIds))
      .map((c) => c.text)

    const { system, prompt } = buildConceptCandidatesPrompt(
      scoped.map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      })),
      {
        sectionHeading: section.heading,
        sectionRole: section.sectionRole,
        blockTypes,
        keyTerms,
        sourceExamples,
        caveats,
      },
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: ConceptCandidatesLlmSchema,
      maxTokens: 2000,
    })

    // The single block type stamped on every candidate is meaningful only when
    // the section's cited blocks are homogeneous; otherwise leave it unset.
    const blockType = blockTypes.length === 1 ? blockTypes[0] : undefined

    const candidates: LearningConceptCandidate[] = []
    for (const c of raw.candidates) {
      const validIds = c.sourceBlockIds.filter((id) => scopedIdSet.has(id))
      if (validIds.length === 0) continue
      candidates.push({
        id: randomUUID(),
        sectionId: section.id,
        label: c.label,
        definition: c.definition,
        sourceBlockIds: validIds,
        blockType,
        sectionRole: section.sectionRole,
        aiAssisted: true,
        validationStatus: 'pending',
      })
    }
    return candidates
  }

  /**
   * Extract WHOLE-ARTICLE concept candidates (DET-351). One LLM pass over the
   * article's real (non-removable) source blocks returns rich candidates +
   * terminology + relationships; the heavy lifting is the CODE guards afterwards,
   * which the model is never trusted to have applied:
   *  - GROUNDING: a candidate whose `sourceBlockIds` contain no real block id is
   *    dropped (the traceability invariant);
   *  - SECTION IDS: `articleSectionIds` are resolved from the candidate's grounded
   *    blocks against the article's section index — never trusted from the model;
   *  - NORMALIZE + DEDUP: `normalizedName` is computed in code and candidates that
   *    share one are merged (provenance/relationships unioned, importance maxed);
   *  - ELIGIBILITY: high-importance candidates are flagged for Concept Library
   *    review (`eligibleForLibraryReview`);
   *  - RELATIONSHIPS: each edge's `type` is mapped to the known enum and its target
   *    resolved to another candidate's normalized name — dangling/self/unknown
   *    edges are dropped;
   *  - NO PROMOTION: `aiAssisted` is forced true and `validationStatus` 'pending';
   *    nothing here creates a Concept row. Promotion stays an explicit user action.
   *
   * Returns the deduped candidate list (possibly empty); never throws beyond the
   * underlying LLM-JSON failure, which the pipeline turns into a best-effort skip.
   */
  async extractArticleConcepts(
    article: ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleConceptCandidate[]> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))
    if (content.length === 0) return []

    const { system, prompt } = buildArticleConceptExtractionPrompt(content, {
      title: article.title.text,
    })
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: ArticleConceptExtractionLlmSchema,
      maxTokens: 4000,
    })

    const sectionIndex = buildBlockToSectionIndex(article)

    // First pass: ground each candidate, compute the code-owned fields, and carry
    // the relationships with their target name normalized (resolution needs the
    // full candidate set, so it happens after dedup).
    const guarded: ArticleConceptCandidate[] = []
    for (const c of raw.candidates) {
      const validIds = c.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue // grounding required
      const normalizedName = normalizeConceptName(c.name)
      if (!normalizedName) continue
      guarded.push({
        id: randomUUID(),
        name: c.name,
        normalizedName,
        domain: c.domain,
        type: c.type,
        shortDefinition: c.shortDefinition,
        sourceBlockIds: validIds,
        articleSectionIds: sectionIdsForBlocks(sectionIndex, validIds),
        importance: c.importance,
        suggestedCognitiveState: c.suggestedCognitiveState,
        eligibleForLibraryReview: c.importance === 'high',
        aiAssisted: true,
        validationStatus: 'pending',
        relationshipCandidates: mapRelationshipCandidates(c.relationships),
      })
    }

    const deduped = dedupeArticleConceptCandidates(guarded)
    return resolveRelationshipTargets(deduped)
  }
}

/**
 * Map untrusted LLM relationship edges to typed candidates: drop any whose `type`
 * is not a known relationship kind, and normalize the target name (resolution to a
 * real candidate happens later, once the full set is known).
 */
function mapRelationshipCandidates(
  edges: { type: string; targetName: string; rationale?: string }[],
): ConceptRelationshipCandidate[] | undefined {
  const mapped: ConceptRelationshipCandidate[] = []
  for (const e of edges) {
    const type = toRelationshipType(e.type)
    if (!type) continue
    const targetNormalizedName = normalizeConceptName(e.targetName)
    if (!targetNormalizedName) continue
    mapped.push({
      type,
      targetNormalizedName,
      ...(e.rationale ? { rationale: e.rationale } : {}),
    })
  }
  return mapped.length > 0 ? mapped : undefined
}

/**
 * Drop relationship edges that don't resolve to another candidate (no dangling
 * targets, no self-edges). Runs after dedup so targets resolve against the final,
 * merged candidate set.
 */
function resolveRelationshipTargets(
  candidates: ArticleConceptCandidate[],
): ArticleConceptCandidate[] {
  const names = new Set(candidates.map((c) => c.normalizedName))
  return candidates.map((c) => {
    const edges = (c.relationshipCandidates ?? []).filter(
      (r) =>
        r.targetNormalizedName !== c.normalizedName &&
        names.has(r.targetNormalizedName),
    )
    return {
      ...c,
      relationshipCandidates: edges.length > 0 ? edges : undefined,
    }
  })
}

/** Depth-first lookup of a section by id, descending into subsections. */
function findSection(
  sections: ArticleSectionV2[],
  sectionId: string,
): ArticleSectionV2 | null {
  for (const s of sections) {
    if (s.id === sectionId) return s
    const nested = findSection(s.subsections ?? [], sectionId)
    if (nested) return nested
  }
  return null
}
