import type { ArticleJsonV2 } from '@/lib/api'

/**
 * A compact v2 fixture for the ArticleView render smoke tests (DET-279). Small
 * but structurally real: it exercises EVERY `ArticleBlock` union member
 * (paragraph, list, quote, pullQuote, table, code, figureAnchor, callout) in one
 * section, all source-grounded, plus a deliberately UNTRACEABLE paragraph (no
 * sourceBlockIds) so the "missing source" / not-clickable path is covered.
 *
 * Kept local to the web package on purpose: the web rig must not import server
 * code, and the renderer contract is what these tests pin.
 */
export const fixtureArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Every block type', source: 'original' },
  subtitle: {
    text: 'A renderer smoke fixture',
    source: 'original',
    sourceBlockIds: ['b1'],
  },
  abstract: [
    {
      id: 'a1',
      text: 'This abstract paragraph is the lede.',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'All blocks',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'],
      blocks: [
        {
          id: 'para1',
          type: 'paragraph',
          text: 'A clickable source-grounded paragraph.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'list1',
          type: 'list',
          ordered: true,
          items: ['First step', 'Second step'],
          sourceBlockIds: ['b3'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'list2',
          type: 'list',
          ordered: false,
          items: ['Bullet one', 'Bullet two'],
          sourceBlockIds: ['b3'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'quote1',
          type: 'quote',
          text: 'A memorable line.',
          attribution: 'Someone',
          sourceBlockIds: ['b4'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'pull1',
          type: 'pullQuote',
          text: 'A pulled excerpt.',
          sourceBlockIds: ['b5'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'table1',
          type: 'table',
          caption: 'A small table',
          header: ['A', 'B'],
          rows: [['1', '2']],
          sourceBlockIds: ['b6'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'code1',
          type: 'code',
          language: 'ts',
          text: 'const x = 1',
          sourceBlockIds: ['b7'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'fig1',
          type: 'figureAnchor',
          caption: 'A figure caption.',
          sourceBlockIds: ['b8'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'callout1',
          type: 'callout',
          calloutType: 'note',
          title: 'Note',
          text: 'A callout body.',
          sourceBlockIds: ['b2'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          // INTENTIONALLY untraceable — renders the error chip, not clickable.
          id: 'broken1',
          type: 'paragraph',
          text: 'This paragraph has no source.',
          sourceBlockIds: [],
          transformationType: 'verbatim',
          fidelityRisk: 'high',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}
