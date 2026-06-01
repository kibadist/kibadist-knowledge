'use client'

import { useState } from 'react'

import {
  ArticleReader,
  ReaderError,
  ReaderSkeleton,
} from '@/components/reader/article-reader'
import type { SourceDocument } from '@/lib/api'

/**
 * Reader demo / story states (DET-209). A non-nav developer page that exercises
 * the Reader against representative article structures and every state, since
 * the web package has no test runner. Visit /reader/demo while signed in.
 */

const STRUCTURED_ARTICLE = `# Spaced Repetition

A learning technique that schedules reviews at *expanding* intervals to fight the **forgetting curve**.

## Why it works

Memory strengthens when retrieval happens just before you'd forget. Reviewing too early wastes effort; too late and the trace is gone.

> "The mind is not a vessel to be filled, but a fire to be kindled."

### Practical scheduling

- Review new material within a day.
- Then after a few days.
- Then after a week, two weeks, a month.

Ordered intervals often used:

1. 1 day
2. 3 days
3. 7 days
4. 16 days

## Implementation notes

A minimal scheduler tracks an \`ease\` factor per card:

\`\`\`js
function nextInterval(prev, ease) {
  return Math.round(prev * ease)
}
\`\`\`

See the [original SM-2 algorithm](https://example.com/sm2) for the full formulation.`

const RUN_ON_TEXT =
  'This is the kind of text that comes back from URL or PDF capture: the server collapses all whitespace into single spaces, so structure is gone and what remains is one long run-on passage. The Reader does not fabricate headings or paragraph breaks that the source never had — that would be dishonest about the material. Instead it renders the prose faithfully inside a comfortable reading column, where measure, line-height, and rhythm still make a single long block far more legible than a cramped textarea ever was. The provenance eyebrow keeps the boundary explicit the whole time: this is source material, not earned knowledge.'

const STRUCTURED_DOC: SourceDocument = {
  version: 1,
  title: 'Spaced Repetition',
  canonicalUrl: 'https://example.com/articles/spaced-repetition',
  extractor: 'html-heuristic@1',
  degraded: false,
  blocks: [
    { id: 'b_h1', type: 'heading', level: 1, text: 'Spaced Repetition' },
    {
      id: 'b_p1',
      type: 'paragraph',
      runs: [
        { text: 'A technique that schedules reviews at ' },
        { text: 'expanding', marks: ['italic'] },
        { text: ' intervals to fight the ' },
        { text: 'forgetting curve', marks: ['bold'] },
        { text: '.' },
      ],
    },
    { id: 'b_h2a', type: 'heading', level: 2, text: 'Why it works' },
    {
      id: 'b_q1',
      type: 'quote',
      runs: [
        { text: 'The mind is a fire to be kindled, not a vessel filled.' },
      ],
    },
    { id: 'b_h2b', type: 'heading', level: 2, text: 'Scheduling' },
    {
      id: 'b_l1',
      type: 'list',
      ordered: true,
      items: [
        [{ text: 'Review within a day' }],
        [{ text: 'Then after three days' }],
        [{ text: 'Then a week, a month' }],
      ],
    },
    {
      id: 'b_c1',
      type: 'code',
      language: 'js',
      text: 'function nextInterval(prev, ease) {\n  return Math.round(prev * ease)\n}',
    },
    {
      id: 'b_t1',
      type: 'table',
      header: true,
      rows: [
        ['Review', 'Interval'],
        ['1st', '1 day'],
        ['2nd', '3 days'],
      ],
    },
    {
      id: 'b_img1',
      type: 'image',
      src: 'https://placehold.co/600x200/png',
      alt: 'Forgetting curve',
      caption: 'The forgetting curve flattens with each review.',
    },
  ],
}

const CASES = [
  'Structured blocks (DET-210)',
  'Structured (markdown)',
  'Run-on plain text (full)',
  'Compact reference',
  'Empty',
  'Loading',
  'Error',
] as const

type Case = (typeof CASES)[number]

export default function ReaderDemoPage() {
  const [active, setActive] = useState<Case>('Structured blocks (DET-210)')

  return (
    <div className='screen'>
      <p className='section-label'>§ Reader · Demo</p>
      <h1>Reader — demo states</h1>
      <p className='lede'>
        Representative article structures and states for the DET-209 reading
        surface.
      </p>

      <div className='seg-row'>
        {CASES.map((c) => (
          <button
            key={c}
            type='button'
            onClick={() => setActive(c)}
            className={`seg${active === c ? ' on' : ''}`}
          >
            {c}
          </button>
        ))}
      </div>

      {active === 'Structured blocks (DET-210)' && (
        <ArticleReader
          document={STRUCTURED_DOC}
          captureSource='URL'
          sourceUrl='https://example.com/articles/spaced-repetition'
          capturedAt='2026-05-29T12:00:00.000Z'
        />
      )}

      {active === 'Structured (markdown)' && (
        <ArticleReader
          content={STRUCTURED_ARTICLE}
          title='Spaced Repetition'
          captureSource='URL'
          sourceUrl='https://example.com/articles/spaced-repetition'
          capturedAt='2026-05-29T12:00:00.000Z'
        />
      )}

      {active === 'Run-on plain text (full)' && (
        <ArticleReader
          content={RUN_ON_TEXT}
          title='Notes captured from the web'
          captureSource='PDF'
          capturedAt='2026-05-29T12:00:00.000Z'
        />
      )}

      {active === 'Compact reference' && (
        <ArticleReader
          content={STRUCTURED_ARTICLE}
          variant='compact'
          showHeader={false}
          storageKey='demo-compact'
        />
      )}

      {active === 'Empty' && <ArticleReader content={null} />}

      {active === 'Loading' && <ReaderSkeleton />}

      {active === 'Error' && (
        <ReaderError
          message='Could not load this source.'
          onRetry={() => setActive('Structured blocks (DET-210)')}
        />
      )}
    </div>
  )
}
