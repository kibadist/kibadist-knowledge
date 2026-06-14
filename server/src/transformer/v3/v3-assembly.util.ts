import { evaluateQualityGateV3 } from './quality-gate.util'
import {
  ARTICLE_JSON_V3,
  ARTICLE_V3_MODE,
  type ArticleCalloutV3,
  type ArticleJsonV3,
  type ArticleParagraphV3,
  type ArticleProvenanceV3,
  type ArticleSectionV3,
  type ArticleShapeV3,
  type ClaimCandidateV3,
  type ConceptCandidateV3,
  type LearningPathItemV3,
  type MisconceptionCandidateV3,
  type RetrievalPromptV3,
  type SourceExampleV3,
  type SourceKind,
  type SourceNoteV3,
  type SourceReferenceV3,
  type TerminologyItemV3,
} from './v3-contract'
import { buildImportantCoverageV3 } from './v3-coverage.util'
import type { V3LearningLlm, V3RewriteLlm } from './v3-llm.schema'

/**
 * Deterministic assembly of an `ArticleJsonV3` from the (schema-validated) rewrite +
 * learning LLM outputs and the real source blocks (DET-343). Pure — NO LLM, NO I/O
 * — and the single place grounding/provenance/ids/status are decided in CODE rather
 * than trusted from the model:
 *
 *  - every fragment's `sourceBlockIds` is filtered to ids that actually exist; a
 *    paragraph/callout that cites no real block becomes `aiAssisted` (the reader
 *    renders it visibly distinct); a claim that cites no real block is KEPT (it is
 *    the gate's "unsupported claim" signal, not noise to hide).
 *  - ids are minted deterministically (`sec-0`, `sec-0-p-1`, `concept-0`, …).
 *  - `sourceNotes`/`references` are derived from the removable/citation blocks so
 *    references live in the Source-notes drawer, never the article body.
 *  - the quality gate runs last, stamping `status` + `qualityReport`.
 */

/** A loaded source block as assembly consumes it. */
export interface AssemblyBlockV3 {
  id: string
  blockType: string
  classification: string | null
  removable: boolean
  text: string
}

/** Generation context stamped into provenance (never article substance). */
export interface V3AssemblyMeta {
  sourceKind: SourceKind
  shape: ArticleShapeV3
  sourceId?: string
  sourceUrl?: string | null
  captureMethod?: 'PASTE' | 'URL' | 'PDF'
  capturedAt?: string
}

const WORDS_PER_MINUTE = 220

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function clamp(text: string, max = 400): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Build the article body + learning layer, then run the gate to finish it. */
export function assembleArticleV3(
  rewrite: V3RewriteLlm,
  learning: V3LearningLlm,
  blocks: AssemblyBlockV3[],
  meta: V3AssemblyMeta,
): ArticleJsonV3 {
  const known = new Set(blocks.map((b) => b.id))
  const keep = (ids: string[]): string[] => {
    const seen = new Set<string>()
    return ids.filter((id) => known.has(id) && !seen.has(id) && seen.add(id))
  }
  const mkParagraph = (
    id: string,
    text: string,
    rawIds: string[],
  ): ArticleParagraphV3 => {
    const sourceBlockIds = keep(rawIds)
    const grounded = sourceBlockIds.length > 0
    return {
      id,
      text: text.trim(),
      sourceBlockIds,
      transformationType: grounded ? 'source_grounded_rewrite' : 'light_reword',
      fidelityRisk: grounded ? 'low' : 'medium',
      aiAssisted: !grounded,
    }
  }

  // --- Body ----------------------------------------------------------------
  const abstract = rewrite.abstract.map((p, j) =>
    mkParagraph(`abs-p-${j}`, p.text, p.sourceBlockIds),
  )

  const sections: ArticleSectionV3[] = rewrite.sections.map((s, i) => {
    const paragraphs = s.paragraphs.map((p, j) =>
      mkParagraph(`sec-${i}-p-${j}`, p.text, p.sourceBlockIds),
    )
    // A section's source ids = its own cited ids ∪ its paragraphs' ids.
    const sourceBlockIds = keep([
      ...s.sourceBlockIds,
      ...paragraphs.flatMap((p) => p.sourceBlockIds),
    ])
    return {
      id: `sec-${i}`,
      heading: s.heading.trim(),
      sectionRole: s.sectionRole,
      conceptFocus: s.conceptFocus,
      targetReaderOutcome: s.targetReaderOutcome,
      sourceBlockIds,
      paragraphs,
    }
  })

  // Section lookup by source-block overlap, for cross-referencing learning items.
  const sectionBlockSets = sections.map((s) => ({
    id: s.id,
    blocks: new Set(s.sourceBlockIds),
  }))
  const sectionHeadingToId = new Map(
    rewrite.sections.map((s, i) => [normalize(s.heading), `sec-${i}`]),
  )
  const sectionsForBlocks = (ids: string[]): string[] => {
    const set = new Set(ids)
    return sectionBlockSets
      .filter((s) => [...s.blocks].some((b) => set.has(b)))
      .map((s) => s.id)
  }

  // --- Learning layer ------------------------------------------------------
  const keyConcepts: ConceptCandidateV3[] = learning.keyConcepts.map((c, i) => {
    const sourceBlockIds = keep(c.sourceBlockIds)
    return {
      id: `concept-${i}`,
      name: c.name.trim(),
      normalizedName: normalize(c.name),
      type: c.type,
      shortDefinition: c.shortDefinition?.trim(),
      sourceBlockIds,
      articleSectionIds: sectionsForBlocks(sourceBlockIds),
      importance: c.importance,
      suggestedCognitiveState: c.importance === 'high' ? 'Parsed' : 'Seen',
      status: 'ai_suggested',
    }
  })
  const conceptIdByName = new Map(
    keyConcepts.map((c) => [c.normalizedName, c.id]),
  )

  const keyClaims: ClaimCandidateV3[] = learning.keyClaims.map((c, i) => {
    const sourceBlockIds = keep(c.sourceBlockIds)
    return {
      id: `claim-${i}`,
      text: c.text.trim(),
      sourceBlockIds,
      articleSectionIds: sectionsForBlocks(sourceBlockIds),
      claimType: c.claimType,
      confidence: c.confidence,
    }
  })

  const terminology: TerminologyItemV3[] = learning.terminology.map((t, i) => ({
    id: `term-${i}`,
    term: t.term.trim(),
    definition: t.definition.trim(),
    sourceBlockIds: keep(t.sourceBlockIds),
  }))

  const retrievalPrompts: RetrievalPromptV3[] = learning.retrievalPrompts.map(
    (p, i) => ({
      id: `prompt-${i}`,
      question: p.question.trim(),
      expectedAnswerSourceBlockIds: keep(p.sourceBlockIds),
      relatedConceptCandidateIds: (p.relatedConceptNames ?? [])
        .map((n) => conceptIdByName.get(normalize(n)))
        .filter((id): id is string => id != null),
      promptType: p.promptType,
      difficulty: p.difficulty,
      status: 'ai_suggested',
    }),
  )

  const misconceptionWarnings: MisconceptionCandidateV3[] =
    learning.misconceptionWarnings.map((m, i) => ({
      id: `misc-${i}`,
      misconception: m.misconception.trim(),
      correction: m.correction.trim(),
      sourceBlockIds: keep(m.sourceBlockIds),
      relatedConceptCandidateIds: [],
      confidence: m.confidence,
      status: 'ai_suggested',
    }))

  const sourceExamples: SourceExampleV3[] = learning.sourceExamples.map(
    (e, i) => {
      const sourceBlockIds = keep(e.sourceBlockIds)
      return {
        id: `ex-${i}`,
        text: e.text.trim(),
        sourceBlockIds,
        relatedSectionIds: sectionsForBlocks(sourceBlockIds),
      }
    },
  )

  const learningPath: LearningPathItemV3[] = learning.learningPath.map(
    (p, i) => ({
      id: `path-${i}`,
      label: p.label.trim(),
      sectionId: p.sectionHeading
        ? sectionHeadingToId.get(normalize(p.sectionHeading))
        : sections[i]?.id,
      outcome: p.outcome?.trim(),
    }),
  )

  // Definition callouts from grounded terminology, placed beside the section that
  // shares a source block (mirrors v2's reference-with-placement callout map).
  const callouts: ArticleCalloutV3[] = terminology
    .filter((t) => t.sourceBlockIds.length > 0)
    .map((t, i) => ({
      id: `callout-${i}`,
      type: 'definition' as const,
      title: t.term,
      body: t.definition,
      sourceBlockIds: t.sourceBlockIds,
      relatedSectionIds: sectionsForBlocks(t.sourceBlockIds),
      fidelityRisk: 'low' as const,
    }))
  const bySection: Record<string, ArticleCalloutV3[]> = {}
  const unplaced: ArticleCalloutV3[] = []
  for (const c of callouts) {
    const target = c.relatedSectionIds?.[0]
    if (target) (bySection[target] ??= []).push(c)
    else unplaced.push(c)
  }

  // --- Source notes + references (deterministic, moved OUT of the body) -----
  const sourceNotes: SourceNoteV3[] = []
  const references: SourceReferenceV3[] = []
  let noteIdx = 0
  let refIdx = 0
  for (const b of blocks) {
    const cls = b.classification
    if (cls === 'CITATION') {
      references.push({
        id: `ref-${refIdx++}`,
        label: clamp(b.text, 200),
        sourceBlockIds: [b.id],
      })
      sourceNotes.push({
        id: `note-${noteIdx++}`,
        kind: 'reference',
        text: clamp(b.text, 200),
        sourceBlockIds: [b.id],
      })
    } else if (cls === 'NAVIGATION_NOISE') {
      sourceNotes.push({
        id: `note-${noteIdx++}`,
        kind: 'removed_navigation',
        text: clamp(b.text, 160),
        sourceBlockIds: [b.id],
      })
    } else if (cls === 'FOOTER' || cls === 'ADVERTISEMENT') {
      sourceNotes.push({
        id: `note-${noteIdx++}`,
        kind: 'low_importance',
        text: clamp(b.text, 160),
        sourceBlockIds: [b.id],
      })
    }
  }

  // --- Reading time --------------------------------------------------------
  const bodyText = [
    ...abstract.map((p) => p.text),
    ...sections.flatMap((s) => s.paragraphs.map((p) => p.text)),
  ]
    .join(' ')
    .trim()
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0
  const readingTimeMinutes = wordCount
    ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))
    : 0

  // Title provenance: a heading block whose text matches ⇒ cleanedOriginal.
  const titleNorm = normalize(rewrite.title)
  const titleFromSource = blocks.some(
    (b) => b.blockType === 'HEADING' && normalize(b.text) === titleNorm,
  )

  const provenance: ArticleProvenanceV3 = {
    sourceKind: meta.sourceKind,
    sourceId: meta.sourceId,
    sourceUrl: meta.sourceUrl ?? null,
    captureMethod: meta.captureMethod,
    capturedAt: meta.capturedAt,
    totalSourceBlocks: blocks.length,
    sourceAvailable: true,
  }

  // Assemble everything except the gate verdict, then run the gate.
  const partial: Omit<ArticleJsonV3, 'status' | 'qualityReport'> = {
    schemaVersion: ARTICLE_JSON_V3,
    mode: ARTICLE_V3_MODE,
    sourceKind: meta.sourceKind,
    shape: meta.shape,
    title: {
      text: rewrite.title.trim(),
      source: titleFromSource ? 'cleanedOriginal' : 'inferred',
    },
    dek: rewrite.dek?.trim(),
    abstract,
    learningPath,
    sections,
    keyConcepts,
    keyClaims,
    terminology,
    sourceExamples,
    misconceptionWarnings,
    retrievalPrompts,
    calloutPlacements: { bySection, unplaced },
    tables: [],
    sourceNotes,
    references,
    provenance,
    readingTimeMinutes,
    generatedAt: undefined,
  }

  const coverageBlocks = blocks.map((b) => ({
    id: b.id,
    classification: b.classification,
    removable: b.removable,
  }))
  const draft: ArticleJsonV3 = {
    ...partial,
    status: 'DRAFT',
    qualityReport: EMPTY_REPORT,
  }
  provenance.representedSourceBlocks = buildImportantCoverageV3(
    draft,
    coverageBlocks,
  ).representedAnyIds.length

  const gate = evaluateQualityGateV3(draft, coverageBlocks)
  return {
    ...partial,
    status: gate.status,
    qualityReport: gate.qualityReport,
  }
}

/** A zeroed report, only used as the gate's throwaway input placeholder. */
const EMPTY_REPORT: ArticleJsonV3['qualityReport'] = {
  sourceCoverageScore: 0,
  importantSourceCoverageScore: 0,
  citationCoverageScore: 0,
  unsupportedClaimCount: 0,
  highSeverityLostInfoCount: 0,
  conceptCandidateCount: 0,
  keyClaimCount: 0,
  retrievalPromptCount: 0,
  tableCount: 0,
  calloutCount: 0,
  exerciseReadinessScore: 0,
  articleReadabilityScore: 0,
  provenanceCompletenessScore: 0,
  reviewerWarnings: [],
  blockerReasons: [],
  regenerationHints: [],
}
