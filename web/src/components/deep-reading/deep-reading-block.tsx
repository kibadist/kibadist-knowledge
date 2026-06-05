'use client'

import type { ReactNode } from 'react'

import type { InlineRun } from '@/lib/api'
import type { ArticleBlockV2 } from '@/lib/article-v2'

import { InlineRuns } from '../reader/inline-runs'

/**
 * Typed renderer for a single Article JSON v2 block (DET-284).
 *
 * It reuses the Reader's inline-run primitive and the shared `.kb-*` typography
 * classes rather than reimplementing article rendering. The one block type with
 * no `SourceDocument` analogue — `callout` — gets its own markup; everything
 * else maps onto the same semantic HTML the source Reader already produces, so
 * the two surfaces stay visually consistent and there is a single source of
 * truth for inline formatting.
 *
 * Every block renders with `id={block.block_id}` so the persisted, stable ids
 * from DET-278 are the DOM anchors for the TOC, key-term jumps, and any future
 * citation/source-span highlighting.
 */
export interface DeepReadingBlockProps {
  block: ArticleBlockV2
  /** Optional key terms to highlight inside text-bearing blocks. */
  keyTerms?: string[]
}

export function DeepReadingBlock({ block, keyTerms }: DeepReadingBlockProps) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.content.level, 1), 3)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3'
      return (
        <Tag id={block.block_id} className={`kb-h${level}`}>
          <Highlighted runs={block.content.runs} terms={keyTerms} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p id={block.block_id} className='kb-paragraph'>
          <Highlighted runs={block.content.runs} terms={keyTerms} />
        </p>
      )
    case 'quote':
      return (
        <blockquote id={block.block_id} className='kb-quote'>
          <Highlighted runs={block.content.runs} terms={keyTerms} />
          {block.content.attribution && (
            <cite className='kb-dr-quote-cite'>
              {block.content.attribution}
            </cite>
          )}
        </blockquote>
      )
    case 'list': {
      const Tag = block.content.ordered ? 'ol' : 'ul'
      return (
        <Tag
          id={block.block_id}
          className={block.content.ordered ? 'kb-ol' : 'kb-ul'}
        >
          {block.content.items.map((item, i) => (
            // List items carry no stable id of their own (read-only surface).
            <li key={i} className='kb-li'>
              <Highlighted runs={item} terms={keyTerms} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre id={block.block_id} className='kb-code-block'>
          <code>{block.content.text}</code>
        </pre>
      )
    case 'callout': {
      const variant = block.content.variant ?? 'note'
      return (
        <aside
          id={block.block_id}
          className={`kb-dr-callout kb-dr-callout--${variant}`}
        >
          {block.content.title && (
            <p className='kb-dr-callout-title'>{block.content.title}</p>
          )}
          <p className='kb-dr-callout-body'>
            <Highlighted runs={block.content.runs} terms={keyTerms} />
          </p>
        </aside>
      )
    }
    case 'image':
      return (
        <figure id={block.block_id} className='kb-reader-figure'>
          {/* Remote, arbitrary-sized article art: a plain lazy <img> is
              intentional (next/image needs configured domains). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.content.src}
            alt={block.content.alt ?? ''}
            loading='lazy'
          />
          {block.content.caption && (
            <figcaption className='kb-reader-caption'>
              {block.content.caption}
            </figcaption>
          )}
        </figure>
      )
    case 'table':
      return (
        <div id={block.block_id} className='kb-reader-table-wrap'>
          <table className='kb-reader-table'>
            {block.content.header && block.content.rows.length > 0 && (
              <thead>
                <tr>
                  {block.content.rows[0].map((cell, i) => (
                    <th key={i}>{cell}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(block.content.header
                ? block.content.rows.slice(1)
                : block.content.rows
              ).map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'divider':
      return <hr id={block.block_id} className='kb-dr-divider' />
  }
}

/**
 * Wraps `InlineRuns`, but when key terms are supplied it highlights their first
 * occurrence per run with a subtle <mark>. Highlighting only touches unmarked,
 * unlinked runs so we never fight inline formatting or break links — a
 * source-safe reading aid, not a rewrite of the prose.
 */
function Highlighted({ runs, terms }: { runs: InlineRun[]; terms?: string[] }) {
  if (!terms || terms.length === 0) return <InlineRuns runs={runs} />

  const pattern = buildTermPattern(terms)
  if (!pattern) return <InlineRuns runs={runs} />

  return (
    <>
      {runs.map((run, i) => {
        // Don't disturb formatted/linked runs — only highlight plain text.
        if (
          run.href ||
          (run.marks && run.marks.length) ||
          run.text.includes('\n')
        ) {
          return <InlineRuns key={i} runs={[run]} />
        }
        return <HighlightedText key={i} text={run.text} pattern={pattern} />
      })}
    </>
  )
}

function HighlightedText({ text, pattern }: { text: string; pattern: RegExp }) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  // `pattern` is global; reset before each run.
  pattern.lastIndex = 0
  let match = pattern.exec(text)
  let key = 0
  while (match) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <mark key={`m${key}`} className='kb-dr-term'>
        {match[0]}
      </mark>,
    )
    key += 1
    lastIndex = match.index + match[0].length
    // Guard against zero-length matches.
    if (match[0].length === 0) pattern.lastIndex += 1
    match = pattern.exec(text)
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}</>
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A single case-insensitive, word-boundaried alternation of all terms. */
function buildTermPattern(terms: string[]): RegExp | null {
  const cleaned = terms
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .sort((a, b) => b.length - a.length) // prefer longer matches first
    .map(escapeRegExp)
  if (cleaned.length === 0) return null
  return new RegExp(`\\b(?:${cleaned.join('|')})\\b`, 'gi')
}
