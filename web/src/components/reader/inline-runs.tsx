import { Fragment } from 'react'

import type { InlineRun } from '@/lib/api'

/**
 * Shared inline-run renderer. Both the source Reader (article-blocks.tsx) and
 * the generated-article Deep Reading Mode (DET-284) render the same `InlineRun`
 * primitive — bold/italic/code/strike marks, links, and hard line breaks — so
 * the logic lives here once rather than being duplicated per surface.
 */

const MARK_CLASS: Record<string, string> = {
  bold: 'kb-bold',
  italic: 'kb-italic',
  code: 'kb-text-code',
  strikethrough: 'kb-strikethrough',
}

export function InlineRuns({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <Run key={i} run={run} />
      ))}
    </>
  )
}

function Run({ run }: { run: InlineRun }) {
  const className =
    run.marks && run.marks.length
      ? run.marks
          .map((m) => MARK_CLASS[m])
          .filter(Boolean)
          .join(' ')
      : undefined

  // Preserve hard line breaks within a run.
  const content = run.text.split('\n').map((line, i, arr) => (
    <Fragment key={i}>
      {line}
      {i < arr.length - 1 && <br />}
    </Fragment>
  ))

  if (run.href) {
    return (
      <a
        href={run.href}
        target='_blank'
        rel='noopener noreferrer'
        className={`kb-link${className ? ` ${className}` : ''}`}
      >
        {content}
      </a>
    )
  }
  if (className) return <span className={className}>{content}</span>
  return <>{content}</>
}
