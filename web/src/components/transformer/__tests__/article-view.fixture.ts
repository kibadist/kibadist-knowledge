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
      // One level of nesting (H2→H3) to exercise the subsection renderer and a
      // source-grounded subheading that opens the inspector (DET-276).
      subsections: [
        {
          id: 's1a',
          heading: 'A nested subsection',
          headingSource: 'original',
          headingSourceBlockIds: ['b9'],
          sourceBlockIds: ['b9'],
          blocks: [
            {
              id: 'subpara1',
              type: 'paragraph',
              text: 'A paragraph inside the subsection.',
              sourceBlockIds: ['b9'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
  // Reading aids (DET-274). In production the SERVER computes these
  // deterministically; the web test includes them so the renderer's TOC (with a
  // nested child), reading-time byline, and Source Highlights paths are covered.
  readingAids: {
    toc: [
      {
        sectionId: 's1',
        heading: 'All blocks',
        headingSource: 'original',
        children: [
          {
            sectionId: 's1a',
            heading: 'A nested subsection',
            headingSource: 'original',
          },
        ],
      },
    ],
    readingTime: { wordCount: 60, minutes: 5 },
    highlights: [
      {
        text: 'A source-grounded highlight claim.',
        sourceBlockIds: ['b2'],
      },
    ],
  },
  // Inline callout placement (DET-272). In production the SERVER computes this
  // (deterministic, no LLM) and attaches it; the web test just includes it in
  // the fixture so the renderer's margin-note / index / unplaced paths are
  // covered. One caveat is placed beside section `s1`; one example is unplaced.
  calloutPlacements: {
    bySection: {
      s1: [
        {
          id: 'co-caveat-0',
          kind: 'caveat',
          text: 'A placed caveat beside the section.',
          sourceBlockIds: ['b2'],
          placementReason: "1/1 source block overlap section 'All blocks'",
        },
      ],
    },
    unplaced: [
      {
        id: 'co-example-0',
        kind: 'example',
        text: 'An unplaced example with nowhere inline to live.',
        sourceBlockIds: ['b6'],
        placementReason: 'No source-block overlap with any section.',
      },
    ],
  },
}

/**
 * A pre-wave v2 article with NO `readingAids` (and an absent `highlights` is
 * implied by the missing aids). Mirrors a legacy/old article that the server's
 * read-time adapter could not enrich — the renderer must not crash and must omit
 * the TOC, the reading-time byline segment, and the Source Highlights box.
 */
export const fixtureArticleNoAids: ArticleJsonV2 = {
  ...fixtureArticle,
  readingAids: undefined,
}
