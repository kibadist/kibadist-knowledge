import type { ArticleV2 } from '@/lib/article-v2'

/**
 * A representative Article JSON v2 fixture (DET-284 demo). Exercises every typed
 * block — paragraph, heading, list, quote, table, code, callout, image,
 * divider — plus key terms and stable section/block ids, so the demo page can
 * stand in for the reading surface while the web package has no test runner.
 */
export const SAMPLE_ARTICLE: ArticleV2 = {
  article_id: 'art_spaced_repetition_v1',
  article_version_id: 'av_1',
  source_id: 'src_spaced_repetition',
  schema_version: 'article_json_v2',
  title: 'Spaced Repetition',
  generated_at: '2026-06-04T12:00:00.000Z',
  sections: [
    {
      section_id: 'sec_intro',
      heading: 'What spaced repetition is',
      order_index: 0,
      key_terms: [
        { term: 'spaced repetition' },
        { term: 'forgetting curve' },
        { term: 'retrieval' },
      ],
      blocks: [
        {
          block_id: 'blk_intro_p1',
          section_id: 'sec_intro',
          order_index: 0,
          type: 'paragraph',
          source_span_ids: ['span_1'],
          content: {
            runs: [
              { text: 'Spaced repetition', marks: ['bold'] },
              {
                text: ' is a learning technique that schedules reviews at expanding intervals to fight the ',
              },
              { text: 'forgetting curve', marks: ['italic'] },
              {
                text: '. Each successful retrieval pushes the next review further out.',
              },
            ],
          },
        },
        {
          block_id: 'blk_intro_quote',
          section_id: 'sec_intro',
          order_index: 1,
          type: 'quote',
          content: {
            runs: [
              {
                text: 'The mind is not a vessel to be filled, but a fire to be kindled.',
              },
            ],
            attribution: 'Plutarch',
          },
        },
      ],
    },
    {
      section_id: 'sec_why',
      heading: 'Why it works',
      order_index: 1,
      key_terms: [{ term: 'retrieval' }, { term: 'desirable difficulty' }],
      concept_candidates: [
        { id: 'cc_retrieval', label: 'Retrieval practice' },
        { id: 'cc_difficulty', label: 'Desirable difficulty' },
      ],
      blocks: [
        {
          block_id: 'blk_why_p1',
          section_id: 'sec_why',
          order_index: 0,
          type: 'paragraph',
          content: {
            runs: [
              {
                text: 'Memory strengthens most when retrieval happens just before you would have forgotten. Reviewing too early wastes effort; too late and the trace is gone.',
              },
            ],
          },
        },
        {
          block_id: 'blk_why_callout',
          section_id: 'sec_why',
          order_index: 1,
          type: 'callout',
          content: {
            variant: 'insight',
            title: 'Key idea',
            runs: [
              {
                text: 'The struggle to recall is the mechanism, not a side effect. This is the principle of ',
              },
              { text: 'desirable difficulty', marks: ['italic'] },
              { text: '.' },
            ],
          },
        },
        {
          block_id: 'blk_why_list',
          section_id: 'sec_why',
          order_index: 2,
          type: 'list',
          content: {
            ordered: false,
            items: [
              [
                {
                  text: 'Retrieval is effortful, so it leaves a stronger trace.',
                },
              ],
              [{ text: 'Spacing forces retrieval from long-term memory.' }],
              [{ text: 'Each review re-stabilises the memory for longer.' }],
            ],
          },
        },
      ],
    },
    {
      section_id: 'sec_schedule',
      heading: 'Scheduling in practice',
      order_index: 2,
      key_terms: [{ term: 'interval' }, { term: 'ease factor' }],
      blocks: [
        {
          block_id: 'blk_sched_h',
          section_id: 'sec_schedule',
          order_index: 0,
          type: 'heading',
          content: { level: 3, runs: [{ text: 'A typical interval ladder' }] },
        },
        {
          block_id: 'blk_sched_table',
          section_id: 'sec_schedule',
          order_index: 1,
          type: 'table',
          content: {
            header: true,
            rows: [
              ['Review', 'Interval'],
              ['1st', '1 day'],
              ['2nd', '3 days'],
              ['3rd', '7 days'],
              ['4th', '16 days'],
            ],
          },
        },
        {
          block_id: 'blk_sched_code',
          section_id: 'sec_schedule',
          order_index: 2,
          type: 'code',
          content: {
            language: 'js',
            text: 'function nextInterval(prev, ease) {\n  return Math.round(prev * ease)\n}',
          },
        },
        {
          block_id: 'blk_sched_divider',
          section_id: 'sec_schedule',
          order_index: 3,
          type: 'divider',
          content: null,
        },
        {
          block_id: 'blk_sched_p',
          section_id: 'sec_schedule',
          order_index: 4,
          type: 'paragraph',
          content: {
            runs: [
              { text: 'The ' },
              { text: 'ease factor', marks: ['code'] },
              {
                text: ' adapts per card: answer well and the interval grows faster; stumble and it shrinks.',
              },
            ],
          },
        },
      ],
    },
  ],
}
