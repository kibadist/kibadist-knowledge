'use client'

import { useState } from 'react'

import {
  ArticleReader,
  ReaderError,
  ReaderSkeleton,
} from '@/components/reader/article-reader'

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

const CASES = [
  'Structured (full)',
  'Run-on plain text (full)',
  'Compact reference',
  'Empty',
  'Loading',
  'Error',
] as const

type Case = (typeof CASES)[number]

export default function ReaderDemoPage() {
  const [active, setActive] = useState<Case>('Structured (full)')

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Reader — demo states</h1>
        <p className='text-sm text-neutral-400'>
          Representative article structures and states for the DET-209 reading
          surface. Toggle the OS color scheme to check light/dark.
        </p>
      </div>

      <div className='flex flex-wrap gap-2'>
        {CASES.map((c) => (
          <button
            key={c}
            type='button'
            onClick={() => setActive(c)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              active === c
                ? 'bg-neutral-100 text-black'
                : 'border border-neutral-700 text-neutral-300 hover:bg-neutral-900'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {active === 'Structured (full)' && (
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
          onRetry={() => setActive('Structured (full)')}
        />
      )}
    </div>
  )
}
