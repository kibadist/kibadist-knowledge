import {
  ARTICLE_SCHEMA_VERSION_V3,
  type ArticleBlockV3,
  type ArticleJsonV3,
  type ArticleSectionV3,
  type ArticleShapeV3,
  type KeyClaim,
  type KeyConcept,
  type LearningPathStep,
  type Provenance,
  type ProvenanceSummary,
  type RetrievalPromptV3,
  type SourceKind,
  type SourceNote,
} from './v3.types'
import type { V3LearningLlm, V3RewriteLlm } from './v3-schemas'

/**
 * Deterministic assembly of an `ArticleJsonV3` from the (already schema-validated)
 * rewrite + learning LLM outputs and the set of REAL source block ids (DET-343).
 * Pure — NO LLM, NO I/O — and the single place provenance/grounding is decided in
 * CODE rather than trusted from the model:
 *
 *  - every block's `sourceBlockIds` is filtered to ids that actually exist; a block
 *    that still cites ≥1 real block is `provenance: 'source'`, otherwise `'scaffold'`
 *    (AI connective tissue the source never contained — marked, never hidden).
 *  - ids are minted deterministically (`sec-0`, `sec-0-b-1`, `concept-0`, …) so the
 *    article is reproducible and learning events can anchor to stable ids.
 *  - concepts / retrieval prompts / source notes MUST be grounded — ungrounded ones
 *    are dropped (they would teach something the source never said).
 *  - claims are KEPT either way but stamped `support: 'grounded' | 'unsupported'`;
 *    an unsupported claim is a SIGNAL the quality gate acts on, never silently lost.
 *  - the provenance summary is computed from the final blocks.
 */

/** Pick the learning shape from the source kind + how concept-dense it is. */
export function selectShape(
  kind: SourceKind,
  conceptCount: number,
): ArticleShapeV3 {
  switch (kind) {
    case 'transcript':
      return 'lesson'
    case 'reference':
      return 'reference_entry'
    case 'structured_article':
      return conceptCount >= 2 ? 'concept_explainer' : 'overview'
    case 'mixed':
      return conceptCount >= 2 ? 'concept_explainer' : 'overview'
  }
}

/** Keep only ids that exist in the source; preserve order, drop duplicates. */
function knownIds(ids: string[], known: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** Source if any real block backs the text, scaffold otherwise. */
function provenanceOf(grounded: string[]): Provenance {
  return grounded.length > 0 ? 'source' : 'scaffold'
}

function assembleSections(
  rewrite: V3RewriteLlm,
  known: ReadonlySet<string>,
): ArticleSectionV3[] {
  return rewrite.sections.map((s, si) => {
    const sectionIds = knownIds(s.sourceBlockIds, known)
    const blocks: ArticleBlockV3[] = s.blocks.map((b, bi) => {
      const grounded = knownIds(b.sourceBlockIds, known)
      return {
        id: `sec-${si}-b-${bi}`,
        type: b.type,
        text: b.text,
        sourceBlockIds: grounded,
        provenance: provenanceOf(grounded),
        fidelityRisk: b.fidelityRisk,
        ...(b.type === 'list' && b.items ? { items: b.items } : {}),
      }
    })
    return {
      id: `sec-${si}`,
      heading: s.heading,
      headingProvenance: provenanceOf(sectionIds),
      sourceBlockIds: sectionIds,
      blocks,
    }
  })
}

/** Resolve a learning step's section refs (heading text OR 1-based index) to ids. */
function resolveSectionRefs(
  refs: string[],
  sections: ArticleSectionV3[],
): string[] {
  const byHeading = new Map(
    sections.map((s) => [s.heading.trim().toLowerCase(), s.id]),
  )
  const out = new Set<string>()
  for (const ref of refs) {
    const trimmed = ref.trim()
    const byName = byHeading.get(trimmed.toLowerCase())
    if (byName) {
      out.add(byName)
      continue
    }
    const asIndex = Number.parseInt(trimmed, 10)
    if (Number.isInteger(asIndex) && sections[asIndex - 1]) {
      out.add(sections[asIndex - 1].id)
    }
  }
  return [...out]
}

function assembleLearning(
  learning: V3LearningLlm,
  sections: ArticleSectionV3[],
  known: ReadonlySet<string>,
): ArticleJsonV3['learning'] {
  // Concepts must be grounded (drop ungrounded — they'd teach unsourced meaning).
  const keyConcepts: KeyConcept[] = learning.keyConcepts
    .map((c, i) => {
      const grounded = knownIds(c.sourceBlockIds, known)
      return grounded.length > 0
        ? {
            id: `concept-${i}`,
            label: c.label,
            definition: c.definition,
            sourceBlockIds: grounded,
            aiAssisted: true as const,
          }
        : null
    })
    .filter((c): c is KeyConcept => c !== null)

  // Claims are kept either way; support reflects whether the source backs them.
  const keyClaims: KeyClaim[] = learning.keyClaims.map((c, i) => {
    const grounded = knownIds(c.sourceBlockIds, known)
    return {
      id: `claim-${i}`,
      text: c.text,
      sourceBlockIds: grounded,
      support: grounded.length > 0 ? 'grounded' : 'unsupported',
    }
  })

  // Retrieval prompts must be grounded (a prompt must be answerable from source).
  const retrievalPrompts: RetrievalPromptV3[] = learning.retrievalPrompts
    .map((p, i) => {
      const grounded = knownIds(p.sourceBlockIds, known)
      return grounded.length > 0
        ? { id: `prompt-${i}`, prompt: p.prompt, sourceBlockIds: grounded }
        : null
    })
    .filter((p): p is RetrievalPromptV3 => p !== null)

  // Source notes must be grounded (a note is an observation ABOUT the source).
  const sourceNotes: SourceNote[] = learning.sourceNotes
    .map((n, i) => {
      const grounded = knownIds(n.sourceBlockIds, known)
      return grounded.length > 0
        ? { id: `note-${i}`, text: n.text, sourceBlockIds: grounded }
        : null
    })
    .filter((n): n is SourceNote => n !== null)

  const learningPath: LearningPathStep[] = learning.learningPath.map(
    (step, i) => ({
      id: `lp-${i}`,
      objective: step.objective,
      sectionIds: resolveSectionRefs(step.sectionRefs, sections),
    }),
  )

  return { learningPath, keyConcepts, keyClaims, retrievalPrompts, sourceNotes }
}

/** Compute the provenance summary from the final article sections. */
export function summarizeProvenance(
  sections: ArticleSectionV3[],
): ProvenanceSummary {
  let total = 0
  let source = 0
  for (const s of sections) {
    for (const b of s.blocks) {
      total++
      if (b.provenance === 'source') source++
    }
  }
  return {
    totalBlocks: total,
    sourceGroundedBlocks: source,
    scaffoldBlocks: total - source,
    groundedPercent: total === 0 ? 100 : Math.round((source / total) * 100),
  }
}

/**
 * Assemble the full v3 article. `known` is the set of real source block ids the
 * article may cite; everything else is dropped/marked in code as described above.
 */
export function assembleArticleV3(
  rewrite: V3RewriteLlm,
  learning: V3LearningLlm,
  sourceKind: SourceKind,
  knownBlockIds: ReadonlySet<string>,
): ArticleJsonV3 {
  const sections = assembleSections(rewrite, knownBlockIds)
  const learningLayer = assembleLearning(learning, sections, knownBlockIds)
  const provenance = summarizeProvenance(sections)
  const shape = selectShape(sourceKind, learningLayer.keyConcepts.length)

  return {
    schemaVersion: ARTICLE_SCHEMA_VERSION_V3,
    sourceKind,
    shape,
    // The rewrite's title/summary are AI framing unless they cite the source; we
    // have no block grounding for them here, so they are scaffold by construction.
    title: { text: rewrite.title, provenance: 'scaffold' },
    summary: { text: rewrite.summary, provenance: 'scaffold' },
    sections,
    learning: learningLayer,
    provenance,
  }
}
