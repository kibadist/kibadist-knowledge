import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture — noisy-headings (DET-276). The source DOES contain heading-type blocks
 * (b1, b4), but they are unusable as section headings: one is a bare site
 * breadcrumb, the other a single ALL-CAPS word that conveys no structure (both
 * are flagged removable navigation noise). The
 * faithful reshaping therefore INFERS section headings from the content rather
 * than anchoring to the noise — every section is `headingSource: 'inferred'`
 * with NO `headingSourceBlockIds` (an inferred heading has no source heading to
 * point at). The article is still fully source-traceable.
 *
 * This is the "source headings exist but are genuinely unusable" case the
 * reshaping-plan guard tolerates (it warns rather than fails — that auditable
 * warning is spec'd directly against the service in
 * reshaping-plan.service.spec.ts; the inferred-reason provenance lives on the
 * PLAN, never on the article).
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'NAVIGATION_NOISE',
    text: 'Home › Docs › Guides',
    removable: true,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Rate limiting protects the API from bursts that would otherwise exhaust shared capacity.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'EXAMPLE',
    text: 'A client that exceeds its quota receives a 429 response with a Retry-After header.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'HEADING',
    classification: 'NAVIGATION_NOISE',
    text: 'MORE',
    removable: true,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'Quotas reset on a fixed window aligned to the start of each minute.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Rate limiting', source: 'inferred' },
  abstract: [
    {
      id: 'a1',
      text: 'Rate limiting protects shared API capacity; clients over quota get a 429 with Retry-After.',
      sourceBlockIds: ['b2', 'b3'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 's1',
      // Inferred: the only nearby heading block (b1) is a navigation breadcrumb,
      // unusable as a section heading — so NO headingSourceBlockIds.
      heading: 'Why rate limiting exists',
      headingSource: 'inferred',
      sourceBlockIds: ['b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Rate limiting protects the API from bursts that would otherwise exhaust shared capacity.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'A client that exceeds its quota receives a 429 response with a Retry-After header.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      // Inferred: b4 ("MORE") is a contentless heading; the section is named
      // from its content instead.
      heading: 'How quotas reset',
      headingSource: 'inferred',
      sourceBlockIds: ['b5'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Quotas reset on a fixed window aligned to the start of each minute.',
          sourceBlockIds: ['b5'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [
    {
      text: 'A client that exceeds its quota receives a 429 response with a Retry-After header.',
      sourceBlockIds: ['b3'],
    },
  ],
  caveats: [],
  originalStructure: [
    { blockId: 'b2', blockType: 'PARAGRAPH', preview: 'Rate limiting protects the API…' },
    { blockId: 'b3', blockType: 'PARAGRAPH', preview: 'A client that exceeds its quota…' },
    { blockId: 'b5', blockType: 'PARAGRAPH', preview: 'Quotas reset on a fixed window…' },
  ],
}

export const noisyHeadings: V2Fixture = {
  name: 'noisy-headings',
  blocks,
  article,
}
