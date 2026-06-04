import type { SourceStructureModel } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * POSITIVE fixture — safe-reorder (DET-275). An argument-essay-like source whose
 * BACKGROUND block (b1) sits first in the source but reads better AFTER the main
 * claim (b2) and its evidence (b3). The plan moves the background down for
 * readability and FULLY audits the move in `reorderings`. The claim and its
 * evidence stay adjacent (no cluster separation), there are no caveats and no
 * chronology markers, so every deterministic check — cluster separation,
 * chronology inversion, unaudited movement — passes and the article approves.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'Open-plan offices became popular as a cost-saving real-estate trend.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Open-plan offices reduce focused work more than they help collaboration.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'EVIDENCE',
    text: 'A study of fifteen firms found face-to-face interaction fell by seventy percent after the switch.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Open-plan offices', source: 'inferred' },
  abstract: [
    {
      id: 'a1',
      text: 'Open-plan offices reduce focused work more than they help collaboration.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  // Reading order leads with the claim (b2), then its evidence (b3), and finally
  // the background (b1) — which sat FIRST in the source. The move is fully audited.
  sections: [
    {
      id: 's1',
      heading: 'The claim',
      headingSource: 'inferred',
      sourceBlockIds: ['b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Open-plan offices reduce focused work more than they help collaboration.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'The evidence',
      headingSource: 'inferred',
      sourceBlockIds: ['b3'],
      blocks: [
        {
          id: 'p2',
          type: 'paragraph',
          text: 'A study of fifteen firms found face-to-face interaction fell by seventy percent after the switch.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's3',
      heading: 'How we got here',
      headingSource: 'inferred',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Open-plan offices became popular as a cost-saving real-estate trend.',
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
    {
      blockId: 'b1',
      blockType: 'PARAGRAPH',
      preview: 'Open-plan offices became popular as a cost-saving…',
    },
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'Open-plan offices reduce focused work…',
    },
    {
      blockId: 'b3',
      blockType: 'PARAGRAPH',
      preview: 'A study of fifteen firms found…',
    },
  ],
  // The background block (b1) moved from source position 0 to reading position 2.
  // The audit records it, so the deterministic unaudited-movement check passes.
  reorderings: [
    {
      sourceBlockId: 'b1',
      fromIndex: 0,
      toIndex: 2,
      reason: 'Background reads better after the claim and its evidence',
      risk: 'low',
    },
  ],
}

/**
 * Structure model: the claim (b2) and its evidence (b3) stay adjacent in reading
 * order, so the cluster check finds no separation; there are no caveats and the
 * source carries no chronology markers, so nothing blocks.
 */
const structureModel: SourceStructureModel = {
  title: { text: 'Open-plan offices', sourceBlockIds: ['b1'] },
  subtitle: null,
  claims: [
    {
      text: 'Open-plan offices reduce focused work more than they help collaboration.',
      sourceBlockIds: ['b2'],
    },
  ],
  definitions: [],
  examples: [],
  caveats: [],
  terminology: [],
  originalOutline: [],
  noiseDecisions: [],
  uncertainBlockIds: [],
}

export const safeReorder: V2Fixture & {
  structureModel: SourceStructureModel
} = {
  name: 'safe-reorder',
  blocks,
  article,
  structureModel,
}
