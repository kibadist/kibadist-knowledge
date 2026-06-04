/**
 * Golden fixture suite (DET-279) — deterministic recorded artifacts, NO live LLM.
 *
 * Each fixture is a hand-authored pair of:
 *  - `blocks`: the classified source blocks the pipeline services consume
 *    (`ClassifiedBlockInput` shape — id / type / classification / text /
 *    removable), and
 *  - `article`: a VALID `ArticleJsonV2` (or, for the legacy fixture, a v1
 *    `SourcePreservingArticle`) that reshapes ONLY those blocks.
 *
 * The fixtures are SHORT (a handful of blocks each) but structurally real: every
 * v2 block type is exercised somewhere across the set (paragraph everywhere;
 * list in howto/glossary; quote + pullQuote in quote-heavy; table in
 * table-heavy; code in code-tutorial; figureAnchor + callout in hybrid; nested
 * subsections in headinged-doc). The specs run the pure utilities (schema
 * validation, coverage, compat adapter, deterministic fidelity traversal,
 * traceability walk) over them — never an LLM.
 *
 * Two NEGATIVE fixtures support the spec's failure cases:
 *  - `unsafeReorder`: a caveat separated from the claim it qualifies (the full
 *    blocking check lands in DET-281 — covered by an `it.todo` for now).
 *  - `unsupportedHighlight`: a readingAids highlight whose sourceBlockIds point
 *    at a block the source does not contain (schema-valid shape, but the
 *    traceability walk flags it).
 */

import type { ClassifiedBlockInput } from '../structure-model.service'
import type {
  ArticleJsonV2,
  SourcePreservingArticle,
} from '../transformer.types'
import { academicAbstract } from './academic-abstract'
import { argumentEssay } from './argument-essay'
import { caveatHeavy } from './caveat-heavy'
import { codeTutorial } from './code-tutorial'
import { glossaryReference } from './glossary-reference'
import { headingedDoc } from './headinged-doc'
import { howtoProcedure } from './howto-procedure'
import { hybrid } from './hybrid'
import { articleV1Legacy } from './legacy-v1'
import { messyTranscript } from './messy-transcript'
import { noisyHeadings } from './noisy-headings'
import { quoteHeavy } from './quote-heavy'
import { safeReorder } from './safe-reorder'
import { tableHeavy } from './table-heavy'
import { unauditedMovement } from './unaudited-movement'
import { unsafeReorder } from './unsafe-reorder'
import { unsupportedHighlight } from './unsupported-highlight'
import { wikipediaExplainer } from './wikipedia-explainer'

/** A v2 golden fixture: source blocks + the hand-authored valid v2 article. */
export interface V2Fixture {
  name: string
  blocks: ClassifiedBlockInput[]
  article: ArticleJsonV2
}

/** The legacy v1 fixture: source blocks + a v1 `SourcePreservingArticle`. */
export interface V1Fixture {
  name: string
  blocks: ClassifiedBlockInput[]
  article: SourcePreservingArticle
}

/** The 12 positive v2 fixtures, keyed by source shape. */
export const v2Fixtures: V2Fixture[] = [
  wikipediaExplainer,
  howtoProcedure,
  argumentEssay,
  academicAbstract,
  messyTranscript,
  codeTutorial,
  tableHeavy,
  quoteHeavy,
  headingedDoc,
  noisyHeadings,
  caveatHeavy,
  glossaryReference,
  hybrid,
]

/** The single legacy v1 fixture (paragraph-only `SourcePreservingArticle`). */
export const v1Fixture: V1Fixture = articleV1Legacy

/**
 * Negative fixtures (DET-279). `unsafeReorder` (now audited-but-still-unsafe —
 * DET-275) and `unauditedMovement` (DET-275, opaque reorder) both BLOCK;
 * `unsupportedHighlight` is flagged by the traceability walk.
 */
export const negativeFixtures = {
  unsafeReorder,
  unsupportedHighlight,
  unauditedMovement,
}

/**
 * Reorder fixtures (DET-275). `safeReorder` is a POSITIVE case (an audited,
 * cluster-safe move that approves); the negative reorder cases live in
 * `negativeFixtures`. Each carries the structure model the cluster + audit checks
 * need.
 */
export const reorderFixtures = {
  safeReorder,
  unsafeReorder,
  unauditedMovement,
}

/** The set of source block ids a fixture's blocks define (the known universe). */
export function knownBlockIds(blocks: ClassifiedBlockInput[]): Set<string> {
  return new Set(blocks.map((b) => b.id))
}
