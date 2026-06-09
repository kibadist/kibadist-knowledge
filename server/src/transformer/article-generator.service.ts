import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildArticlePrompt } from './article-generator.prompt'
import { repairArticleLlmV2 } from './article-llm-repair.util'
import { completeJson } from './llm-json.util'
import type { ArticleLlmV2, ReshapingPlan } from './schemas'
import { ArticleLlmV2Schema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import { repairArticleTraceability } from './traceability-repair.util'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  SectionRole,
} from './transformer.types'
import { ARTICLE_SCHEMA_VERSION } from './transformer.types'

/** Max chars of a block shown in the originalStructure preview. */
const PREVIEW_CHARS = 120

/**
 * Article-generator service (DET-253 → v2 typed blocks, DET-271). The LLM emits
 * the v2 article MINUS the code-owned fields via `completeJson(ArticleLlmV2Schema)`,
 * then CODE post-processing:
 *  - traceability repair (DET-319) prunes hallucinated `sourceBlockIds` BEFORE
 *    validation — invented ids are dropped, and a block/section/entry left with
 *    no real source is dropped — so one invented cuid no longer FAILs the whole
 *    article. `assertKnownIds` then walks every cited id (paragraphs, lists,
 *    quotes, tables, code, callouts, pull-quotes, sections + subsections,
 *    abstract, keyTerms, examples, caveats, subtitle) as the final loud guard
 *    for anything the prune missed → article FAILED.
 *  - `originalStructure` is re-derived deterministically from the blocks
 *    (blockId, blockType, ≤120-char preview) — never trusted from the model.
 *  - `schemaVersion: 'v2'` is stamped in code after validation (not prompt-trusted).
 *  - GENRE shape + roles (DET-273): the article's `shape` is COPIED from the plan
 *    in code (the LLM schema cannot carry it), and each section's `sectionRole` is
 *    OVERWRITTEN from the matching plan section (by heading, falling back to
 *    document order) — the LLM's own role is discarded, so a role the plan did not
 *    assign can never survive. Subsections are synced one level the same way.
 *  - AUDITED REORDERINGS (DET-275): the article's `reorderings` audit is COPIED
 *    from the plan in code (the LLM schema cannot carry it); only entries the plan
 *    declared survive, and an empty/absent audit omits the field. The LLM can
 *    never inject a reorder claim.
 *  - other later-wave fields (readingAids/calloutPlacements) are never requested
 *    and the LLM schema cannot carry them, so the artifact is clean by
 *    construction.
 */
@Injectable()
export class ArticleGeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    plan: ReshapingPlan,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleJsonV2> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildArticlePrompt(JSON.stringify(plan), content)
    const llm = await completeJson(this.ai, {
      system,
      prompt,
      schema: ArticleLlmV2Schema,
      // Two pre-validation repairs (pure, run on every attempt): first absorb
      // benign SHAPE drift (missing internal anchor ids, a container section with
      // no blocks, an empty subtitle); then prune hallucinated SOURCE provenance
      // (invented sourceBlockIds / blocks/sections left unsourced) so one model
      // slip doesn't FAIL the whole article via assertKnownIds. assertKnownIds
      // below still guards loudly against anything the prune missed.
      repair: (parsed) =>
        repairArticleTraceability(repairArticleLlmV2(parsed), known),
      // Tables/code can be large; give the model headroom over the v1 budget.
      maxTokens: 10000,
    })

    assertKnownIds(llm, known)

    // Re-derive the outline reference deterministically (kept-blocks only, in
    // source order) rather than trusting the model.
    const originalStructure = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        blockId: b.id,
        blockType: b.type,
        preview: b.text.slice(0, PREVIEW_CHARS),
      }))

    // Sync each section's role FROM THE PLAN (DET-273) — the LLM's own role is
    // discarded so only plan-assigned roles survive. Match by heading, falling
    // back to document order.
    const sections = syncSectionRoles(llm.sections, plan.sections)

    // Stamp the version in code AFTER validation; copy `shape` from the plan
    // (never prompt-trusted); copy the audited `reorderings` from the plan in code
    // (DET-275 — the LLM schema cannot carry them; only entries the plan declared
    // survive, and an empty/absent audit omits the field). Other later-wave fields
    // are absent on the LLM artifact, so the result is a clean native v2 article.
    const reorderings = plan.reorderings ?? []
    return {
      schemaVersion: ARTICLE_SCHEMA_VERSION,
      mode: llm.mode,
      title: llm.title,
      ...(llm.subtitle ? { subtitle: llm.subtitle } : {}),
      abstract: llm.abstract,
      sections,
      keyTerms: llm.keyTerms,
      sourceExamples: llm.sourceExamples,
      caveats: llm.caveats,
      originalStructure,
      ...(plan.shape ? { shape: plan.shape } : {}),
      ...(reorderings.length > 0 ? { reorderings } : {}),
    }
  }
}

/**
 * Overwrite each article section's `sectionRole` with the matching plan section's
 * role (DET-273). The plan is the single authority for roles: the generator's own
 * sectionRole is dropped and replaced by the plan's (or removed when the plan
 * assigned none). Plan sections are matched by heading first, then by document
 * order; subsections are synced one level the same way.
 */
function syncSectionRoles(
  sections: ArticleLlmV2['sections'],
  planSections: ReshapingPlan['sections'],
): ArticleSectionV2[] {
  const byHeading = new Map(planSections.map((p) => [p.heading, p]))
  return sections.map((section, i) => {
    const planSection = byHeading.get(section.heading) ?? planSections[i]
    const role = planSection?.sectionRole as SectionRole | undefined
    const next: ArticleSectionV2 = {
      ...(section as ArticleSectionV2),
      ...(planSection?.subsections && section.subsections
        ? {
            subsections: syncSectionRoles(
              section.subsections,
              planSection.subsections,
            ),
          }
        : {}),
    }
    if (role) next.sectionRole = role
    else delete next.sectionRole
    return next
  })
}

/**
 * Every cited block id must reference a real source block, else throw (FAILED).
 * Walks ALL typed block types and nested subsections: each block carries its own
 * sourceBlockIds (a quote's attribution, a table's cells and a list's items are
 * part of that block's content), so the ids live at the block level.
 */
function assertKnownIds(
  article: ArticleLlmV2,
  known: ReadonlySet<string>,
): void {
  const unknown = new Set<string>()
  const check = (ids: string[]) => {
    for (const id of ids) if (!known.has(id)) unknown.add(id)
  }

  const walkSection = (
    s: ArticleLlmV2['sections'][number] | ArticleSectionV2,
  ) => {
    check(s.sourceBlockIds)
    if (s.headingSourceBlockIds) check(s.headingSourceBlockIds)
    for (const b of s.blocks) check(b.sourceBlockIds)
    for (const sub of s.subsections ?? []) walkSection(sub)
  }

  if (article.subtitle) check(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) check(p.sourceBlockIds)
  for (const s of article.sections) walkSection(s)
  for (const t of article.keyTerms) check(t.sourceBlockIds)
  for (const e of article.sourceExamples) check(e.sourceBlockIds)
  for (const c of article.caveats) check(c.sourceBlockIds)

  if (unknown.size > 0) {
    throw new Error(
      `Article references unknown block ids: ${[...unknown].join(', ')}`,
    )
  }
}
