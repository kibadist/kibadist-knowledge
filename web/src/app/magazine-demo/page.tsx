'use client'

import { MagazineArticle } from '@/components/magazine/magazine-article'
import type { ArticleEnrichment } from '@/lib/api'
import {
  ARTICLE_JSON_V2,
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
} from '@/lib/article-v2'

/**
 * Visual test harness for the Compendium magazine render (DET-318/319).
 *
 * This is a PUBLIC route (outside the authenticated `(app)` group) so the
 * layout can be eyeballed in the browser without a login, a backend, or any
 * gpt-image-1 cost. It feeds `<MagazineArticle>` a hand-built fixture that
 * exercises every surface — the source-grounded lede, drop-cap, § section bars,
 * pull-quote, marginalia, list, table, an inline-SVG figure plate, the see-also
 * rail — plus a fixture `enrichment` so the AI-labelled headword metadata
 * (pronunciation, etymology, classification, key-facts) is visible too.
 *
 * It is wrapped in `.kbapp` because the editorial color tokens live there; the
 * fonts come from the root layout. Real articles render the same component with
 * data from `getTransformedArticle`.
 */

// A tiny schematic in the house line-diagram style, inlined as a data URI so the
// plate has real content without an authenticated image fetch.
const LADDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280">
  <line x1="40" y1="240" x2="600" y2="240" stroke="#1a1714" stroke-width="2.2"/>
  <line x1="40" y1="40" x2="40" y2="240" stroke="#1a1714" stroke-width="2.2"/>
  ${[
    { x: 110, h: 50, label: '1d' },
    { x: 230, h: 100, label: '3d' },
    { x: 350, h: 150, label: '7d' },
    { x: 470, h: 210, label: '16d' },
  ]
    .map(
      (b) =>
        `<rect x="${b.x}" y="${240 - b.h}" width="70" height="${b.h}" fill="#f3d27a" stroke="#1a1714" stroke-width="1.6"/>` +
        `<text x="${b.x + 35}" y="${240 - b.h - 10}" text-anchor="middle" font-family="monospace" font-size="15" fill="#8a2a1f">${b.label}</text>`,
    )
    .join('')}
  <text x="320" y="272" text-anchor="middle" font-family="monospace" font-size="13" fill="#6b6157">EXPANDING REVIEW INTERVALS</text>
</svg>`

function para(sectionId: string, idx: number, text: string): ArticleBlockV2 {
  return {
    block_id: `${sectionId}-p${idx}`,
    section_id: sectionId,
    order_index: idx,
    type: 'paragraph',
    content: { runs: [{ text }] },
  }
}

const SECTIONS: ArticleSectionV2[] = [
  {
    // The `-abstract` suffix makes the magazine lift this into the italic lede.
    section_id: 'demo-abstract',
    heading: 'Overview',
    order_index: 0,
    blocks: [
      para(
        'demo-abstract',
        0,
        'Spaced repetition is a learning technique that schedules reviews at expanding intervals to fight the forgetting curve, so that each idea is revisited just before it would slip away.',
      ),
    ],
  },
  {
    section_id: 'demo-what',
    heading: 'What it is',
    order_index: 1,
    key_terms: [
      { term: 'Forgetting curve' },
      { term: 'Retrieval' },
      { term: 'Desirable difficulty' },
    ],
    blocks: [
      para(
        'demo-what',
        0,
        'Memory fades on a predictable curve. Left alone, a freshly learned fact decays within days; each successful recall, however, flattens that curve and pushes the next lapse further out. Spaced repetition turns this into a schedule: review on the cusp of forgetting, and the effort of retrieval re-stabilises the memory for longer.',
      ),
      {
        block_id: 'demo-what-callout',
        section_id: 'demo-what',
        order_index: 1,
        type: 'callout',
        content: {
          variant: 'insight',
          title: 'Why effort helps',
          runs: [
            {
              text: 'The struggle to recall is the mechanism, not a side effect — it is the principle of desirable difficulty.',
            },
          ],
        },
      },
      para(
        'demo-what',
        2,
        'The interval grows with each success and shrinks after a stumble, so the schedule adapts to how well a given item is actually known rather than treating everything the same.',
      ),
    ],
  },
  {
    section_id: 'demo-why',
    heading: 'Why it works',
    order_index: 2,
    blocks: [
      para(
        'demo-why',
        0,
        'Reviewing too early wastes effort; too late and the trace is already gone. The sweet spot is the moment just before forgetting, where retrieval is effortful but still possible.',
      ),
      {
        block_id: 'demo-why-quote',
        section_id: 'demo-why',
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
      {
        block_id: 'demo-why-list',
        section_id: 'demo-why',
        order_index: 2,
        type: 'list',
        content: {
          ordered: false,
          items: [
            [{ text: 'Spacing forces retrieval from long-term memory.' }],
            [{ text: 'Each review re-stabilises the trace for longer.' }],
            [{ text: 'Failures shorten the interval; successes lengthen it.' }],
          ],
        },
      },
    ],
  },
  {
    section_id: 'demo-practice',
    heading: 'Scheduling in practice',
    order_index: 3,
    blocks: [
      para(
        'demo-practice',
        0,
        'A typical interval ladder doubles or more with each successful review. The ease factor adapts per card: answer well and the interval grows faster; stumble and it resets.',
      ),
      {
        block_id: 'demo-practice-table',
        section_id: 'demo-practice',
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
        block_id: 'demo-practice-fig',
        section_id: 'demo-practice',
        order_index: 2,
        type: 'image',
        content: {
          src: `data:image/svg+xml,${encodeURIComponent(LADDER_SVG)}`,
          alt: 'Bar chart of expanding review intervals',
          caption:
            'A typical interval ladder — each successful recall pushes the next review further out.',
        },
      },
    ],
  },
]

const ARTICLE: ArticleV2 = {
  article_id: 'demo-article',
  source_id: 'demo-source',
  schema_version: ARTICLE_JSON_V2,
  title: 'Spaced Repetition',
  generated_at: '2026-06-09T00:00:00.000Z',
  sections: SECTIONS,
}

const ENRICHMENT: ArticleEnrichment = {
  pronunciation: '/speɪst ˌrɛpɪˈtɪʃ(ə)n/',
  partOfSpeech: 'noun',
  etymology:
    'From Latin spatium (“interval, space”) and repetitio (“a repeating”) — literally, repetition spaced out over time.',
  classification: 'Technique · Cognitive psychology',
  keyFacts: [
    { label: 'Field', value: 'Memory & learning' },
    { label: 'First studied', value: '1885 · Hermann Ebbinghaus' },
    { label: 'Also called', value: 'Spaced practice; distributed practice' },
    { label: 'Key effect', value: 'The spacing effect' },
  ],
}

export default function MagazineDemoPage() {
  return (
    <div className='kbapp'>
      <main className='page'>
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            margin: '0 0 8px',
          }}
        >
          ✦ Visual harness · fixture data · /magazine-demo
        </p>
        <MagazineArticle
          article={ARTICLE}
          articleId='demo-article'
          illustrations={[]}
          enrichment={ENRICHMENT}
          provenance={{
            sourceUrl: 'https://example.com/articles/spaced-repetition',
            captureSource: 'URL',
          }}
        />
      </main>
    </div>
  )
}
