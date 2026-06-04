import type { SourceStructureModel } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * NEGATIVE fixture — unsafe-reorder. The source states a claim (b2) immediately
 * qualified by a caveat (b3); the article reorders so the caveat is pushed to
 * the very end, far from the claim it limits — a meaning-altering separation.
 *
 * This fixture is SCHEMA-VALID and every fragment is traceable: the violation is
 * semantic (claim/caveat cluster separation), which the deterministic blocking
 * check in DET-281 will catch via the reorderings audit. Until then the spec
 * marks it `it.todo('blocks caveat-separation reorder (DET-281)')`.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Intermittent fasting and weight loss',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Intermittent fasting reliably produces weight loss in the studied groups.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'But only when total daily calories also fall — fasting alone changed nothing.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The trials ran for twelve weeks across four hundred participants.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Intermittent fasting and weight loss', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'Intermittent fasting produces weight loss in the studied groups.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'The result',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Intermittent fasting reliably produces weight loss in the studied groups.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'medium',
        },
      ],
    },
    {
      id: 's2',
      heading: 'About the trials',
      headingSource: 'inferred',
      sourceBlockIds: ['b4'],
      blocks: [
        {
          id: 'p2',
          type: 'paragraph',
          text: 'The trials ran for twelve weeks across four hundred participants.',
          sourceBlockIds: ['b4'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's3',
      heading: 'A note',
      headingSource: 'inferred',
      sourceBlockIds: ['b3'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Fasting only helped when total daily calories also fell — fasting alone changed nothing.',
          sourceBlockIds: ['b3'],
          transformationType: 'light_reword',
          fidelityRisk: 'high',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [
    {
      text: 'Fasting only helped when total daily calories also fell.',
      sourceBlockIds: ['b3'],
    },
  ],
  originalStructure: [
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'Intermittent fasting reliably produces weight loss…',
    },
    {
      blockId: 'b3',
      blockType: 'PARAGRAPH',
      preview: 'But only when total daily calories also fall…',
    },
  ],
  // AUDITED-BUT-UNSAFE (DET-275). The audit FULLY records the moves: the caveat
  // block (b3) was pushed to the end and the trials block (b4) consequently moved
  // up. Both anchors are covered, so the deterministic unaudited-movement check is
  // satisfied — yet the move is still UNSAFE (the caveat is now two sections from
  // the claim it qualifies), so the cluster check BLOCKS regardless of the audit.
  // The b3 entry is risk:'high', which also surfaces a medium emphasisChanges note.
  reorderings: [
    {
      sourceBlockId: 'b3',
      fromIndex: 2,
      toIndex: 4,
      reason: 'Grouped as a closing note',
      risk: 'high',
    },
    {
      sourceBlockId: 'b4',
      fromIndex: 3,
      toIndex: 2,
      reason: 'Trials detail moved up after the caveat was relocated',
      risk: 'low',
    },
  ],
}

/**
 * Minimal structure model for the cluster check (DET-281). The claim (b2) and
 * the caveat that qualifies it (b3) are source-ADJACENT (positions 1 and 2), so
 * the caveat is anchored to the claim; the article renders the claim in section 0
 * and the caveat in section 2 → a separation of 2 (> the gap-1 threshold), which
 * the cluster util flags as a high-severity, blocking structuralFinding.
 */
const structureModel: SourceStructureModel = {
  title: {
    text: 'Intermittent fasting and weight loss',
    sourceBlockIds: ['b1'],
  },
  subtitle: null,
  claims: [
    {
      text: 'Intermittent fasting reliably produces weight loss in the studied groups.',
      sourceBlockIds: ['b2'],
    },
  ],
  definitions: [],
  examples: [],
  caveats: [
    {
      text: 'Fasting only helped when total daily calories also fell.',
      sourceBlockIds: ['b3'],
    },
  ],
  terminology: [],
  originalOutline: [
    { heading: 'Intermittent fasting and weight loss', sourceBlockIds: ['b1'] },
  ],
  noiseDecisions: [],
  uncertainBlockIds: [],
}

export const unsafeReorder: V2Fixture & {
  structureModel: SourceStructureModel
} = {
  name: 'unsafe-reorder',
  blocks,
  article,
  structureModel,
}
