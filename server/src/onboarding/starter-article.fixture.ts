import { TransformerBlockType } from '@kibadist/prisma'

import type { ArticleJsonV2 } from '../transformer/transformer.types'

/**
 * The built-in starter article (DET-307).
 *
 * The first-run walkthrough seeds a REAL transformed article server-side so the
 * new user's first loop runs over genuine pipeline rows — a TransformerSource +
 * its versioned blocks + a FINAL TransformedArticle — and renders through the
 * ordinary reading surface with NO special-case code. The content mirrors the web
 * demo fixture's topic (`web/src/components/deep-reading/sample-article.ts`,
 * "Spaced Repetition") but is authored here in the SERVER's `ArticleJsonV2` shape
 * because the server can't import web code; the two are the same article, told for
 * two different consumers.
 *
 * Every article paragraph/term/example/caveat cites the source-block ids defined
 * in {@link STARTER_SOURCE_BLOCKS}, so the source inspector, coverage view, and
 * concept-extraction grounding all resolve exactly as they do for a real source.
 * These ids are STABLE constants (the source is seeded verbatim each time), so the
 * walkthrough is reproducible across re-seeds.
 */

/** A source block to persist as a `TransformerSourceBlock` (version 1). */
export interface StarterSourceBlock {
  id: string
  orderIndex: number
  blockType: TransformerBlockType
  text: string
}

// The verbatim source the article is traceable to. Ordered exactly as a reader
// would meet it; the article reshapes this into sections without adding substance.
export const STARTER_SOURCE_BLOCKS: StarterSourceBlock[] = [
  {
    id: 'sb_title',
    orderIndex: 0,
    blockType: TransformerBlockType.HEADING,
    text: 'Spaced Repetition',
  },
  {
    id: 'sb_intro',
    orderIndex: 1,
    blockType: TransformerBlockType.PARAGRAPH,
    text: 'Spaced repetition is a learning technique that schedules reviews at expanding intervals to fight the forgetting curve. Each time you successfully recall something, the next review is pushed further out.',
  },
  {
    id: 'sb_forgetting_h',
    orderIndex: 2,
    blockType: TransformerBlockType.HEADING,
    text: 'The forgetting curve',
  },
  {
    id: 'sb_forgetting_p',
    orderIndex: 3,
    blockType: TransformerBlockType.PARAGRAPH,
    text: 'Hermann Ebbinghaus found that memory of new material decays rapidly at first and then levels off. Without review, most of what you learn today is gone within days. A well-timed review resets the curve before the memory disappears.',
  },
  {
    id: 'sb_retrieval_h',
    orderIndex: 4,
    blockType: TransformerBlockType.HEADING,
    text: 'Why retrieval beats rereading',
  },
  {
    id: 'sb_retrieval_p',
    orderIndex: 5,
    blockType: TransformerBlockType.PARAGRAPH,
    text: 'Re-reading feels productive but mostly builds familiarity, not memory. Retrieval — trying to recall the answer before you check it — is the act that strengthens the trace. The effort of recall is the point, so a review that feels a little hard is doing more than one that feels easy.',
  },
  {
    id: 'sb_schedule_h',
    orderIndex: 6,
    blockType: TransformerBlockType.HEADING,
    text: 'Designing a review schedule',
  },
  {
    id: 'sb_schedule_p',
    orderIndex: 7,
    blockType: TransformerBlockType.PARAGRAPH,
    text: 'A simple schedule reviews a new item after one day, then three days, then a week, then a month — stretching the gap each time recall succeeds and shrinking it when recall fails. Algorithms like SM-2 automate this by tracking how easily each item was recalled.',
  },
  {
    id: 'sb_example',
    orderIndex: 8,
    blockType: TransformerBlockType.QUOTE,
    text: 'A medical student who reviews a drug interaction on days 1, 3, 7, and 21 will remember it far longer than one who crams the same four reviews into a single evening.',
  },
  {
    id: 'sb_caveat',
    orderIndex: 9,
    blockType: TransformerBlockType.PARAGRAPH,
    text: 'Spaced repetition strengthens memory for discrete facts; it does not, on its own, build the connections that turn facts into understanding. Pair it with explaining ideas in your own words and linking them to what you already know.',
  },
]

/** The flat source text (blocks joined by blank lines), used as the inbox row's
 *  raw material and the TransformerSource `rawContent`. */
export const STARTER_SOURCE_TEXT = STARTER_SOURCE_BLOCKS.map(
  (b) => b.text,
).join('\n\n')

export const STARTER_SOURCE_TITLE = 'Spaced Repetition'

const para = (
  id: string,
  text: string,
  sourceBlockIds: string[],
): ArticleJsonV2['sections'][number]['blocks'][number] => ({
  id,
  type: 'paragraph',
  sourceBlockIds,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
  text,
})

/**
 * The FINAL article JSON, in the server's `ArticleJsonV2` contract. The read
 * boundary (`getArticle`) layers callout placement + reading aids on top, exactly
 * as it does for any stored article, so the starter needs neither here.
 */
export const STARTER_ARTICLE_JSON: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Spaced Repetition', source: 'original' },
  subtitle: {
    text: 'How expanding review intervals fight forgetting',
    source: 'inferred',
    sourceBlockIds: ['sb_intro'],
  },
  abstract: [
    {
      id: 'ab_1',
      text: 'Spaced repetition schedules reviews at expanding intervals so that each successful recall pushes the next review further out — turning the forgetting curve to your advantage.',
      sourceBlockIds: ['sb_intro'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 'sec_what',
      heading: 'What spaced repetition is',
      headingSource: 'original',
      sourceBlockIds: ['sb_intro'],
      blocks: [
        para(
          'b_what_1',
          'Spaced repetition is a learning technique that schedules reviews at expanding intervals to fight the forgetting curve. Each time you successfully recall something, the next review is pushed further out.',
          ['sb_intro'],
        ),
      ],
    },
    {
      id: 'sec_forgetting',
      heading: 'The forgetting curve',
      headingSource: 'original',
      sourceBlockIds: ['sb_forgetting_p'],
      blocks: [
        para(
          'b_forgetting_1',
          'Hermann Ebbinghaus found that memory of new material decays rapidly at first and then levels off. Without review, most of what you learn today is gone within days. A well-timed review resets the curve before the memory disappears.',
          ['sb_forgetting_p'],
        ),
      ],
    },
    {
      id: 'sec_retrieval',
      heading: 'Why retrieval beats rereading',
      headingSource: 'original',
      sourceBlockIds: ['sb_retrieval_p'],
      blocks: [
        para(
          'b_retrieval_1',
          'Re-reading feels productive but mostly builds familiarity, not memory. Retrieval — trying to recall the answer before you check it — is the act that strengthens the trace. The effort of recall is the point, so a review that feels a little hard is doing more than one that feels easy.',
          ['sb_retrieval_p'],
        ),
      ],
    },
    {
      id: 'sec_schedule',
      heading: 'Designing a review schedule',
      headingSource: 'original',
      sourceBlockIds: ['sb_schedule_p'],
      blocks: [
        para(
          'b_schedule_1',
          'A simple schedule reviews a new item after one day, then three days, then a week, then a month — stretching the gap each time recall succeeds and shrinking it when recall fails. Algorithms like SM-2 automate this by tracking how easily each item was recalled.',
          ['sb_schedule_p'],
        ),
        {
          id: 'b_schedule_quote',
          type: 'quote',
          sourceBlockIds: ['sb_example'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
          text: 'A medical student who reviews a drug interaction on days 1, 3, 7, and 21 will remember it far longer than one who crams the same four reviews into a single evening.',
        },
      ],
    },
  ],
  keyTerms: [
    { term: 'spaced repetition', sourceBlockIds: ['sb_intro'] },
    { term: 'forgetting curve', sourceBlockIds: ['sb_forgetting_p'] },
    { term: 'retrieval', sourceBlockIds: ['sb_retrieval_p'] },
  ],
  sourceExamples: [
    {
      text: 'A medical student who reviews a drug interaction on days 1, 3, 7, and 21 will remember it far longer than one who crams the same four reviews into a single evening.',
      sourceBlockIds: ['sb_example'],
    },
  ],
  caveats: [
    {
      text: 'Spaced repetition strengthens memory for discrete facts; it does not, on its own, build the connections that turn facts into understanding.',
      sourceBlockIds: ['sb_caveat'],
    },
  ],
  originalStructure: STARTER_SOURCE_BLOCKS.map((b) => ({
    blockId: b.id,
    blockType: b.blockType,
    preview: b.text.slice(0, 80),
  })),
}
