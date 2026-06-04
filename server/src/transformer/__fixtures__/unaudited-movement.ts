import type { SourceStructureModel } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * NEGATIVE fixture — unaudited-movement (DET-275). The reading order inverts the
 * source order (section citing b3 reads first, the section citing b1 reads last)
 * but `reorderings` is EMPTY — the move is opaque. The content is deliberately
 * neutral: no caveats, no evidence/claim cluster, no chronology markers, so the
 * cluster + chronology checks find nothing. The ONLY violation is the unaudited
 * movement, which the deterministic audit turns into a high-severity, blocking
 * structuralFinding (an undeclared reorder is treated as unsafe).
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'Apples are typically red or green.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'Oranges are a citrus fruit.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'Bananas grow in tropical climates.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Three fruits', source: 'inferred' },
  abstract: [],
  // Reading order renders b3, then b2, then b1 — fully inverted vs source order —
  // with NO reorderings audit. Every section move is therefore unaudited.
  sections: [
    {
      id: 's3',
      heading: 'Bananas',
      headingSource: 'inferred',
      sourceBlockIds: ['b3'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Bananas grow in tropical climates.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'Oranges',
      headingSource: 'inferred',
      sourceBlockIds: ['b2'],
      blocks: [
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Oranges are a citrus fruit.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's1',
      heading: 'Apples',
      headingSource: 'inferred',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Apples are typically red or green.',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    { blockId: 'b1', blockType: 'PARAGRAPH', preview: 'Apples are typically…' },
    { blockId: 'b2', blockType: 'PARAGRAPH', preview: 'Oranges are a citrus…' },
    { blockId: 'b3', blockType: 'PARAGRAPH', preview: 'Bananas grow in…' },
  ],
  // No audit: every move is unaudited.
  reorderings: [],
}

/** Minimal structure model with no claims/caveats so only the audit fires. */
const structureModel: SourceStructureModel = {
  title: { text: 'Three fruits', sourceBlockIds: ['b1'] },
  subtitle: null,
  claims: [],
  definitions: [],
  examples: [],
  caveats: [],
  terminology: [],
  originalOutline: [],
  noiseDecisions: [],
  uncertainBlockIds: [],
}

export const unauditedMovement: V2Fixture & {
  structureModel: SourceStructureModel
} = {
  name: 'unaudited-movement',
  blocks,
  article,
  structureModel,
}
