'use client'

import { Fragment } from 'react'

import type { InlineRun, SourceBlock } from '@/lib/api'

/**
 * Structured block renderer (DET-210). Renders a SourceDocument's blocks as
 * semantic HTML — real headings, paragraphs, lists, quotes, code, figures, and
 * tables — reusing the reader's typography classes (.kb-* from editor.css +
 * reader.css overrides).
 *
 * Why not Lexical here: the read-only Lexical path (article-body.tsx) covers
 * legacy string/markdown content, but Lexical has no built-in image/table nodes
 * and registering custom ones buys nothing for a read-only surface. Rendering
 * structured blocks directly keeps the output semantically correct, gives every
 * block a stable DOM id (its block id) for TOC + DET-208 citation anchoring, and
 * avoids the markdown round-trip that would re-flatten structure.
 */
export interface ArticleBlocksProps {
  blocks: SourceBlock[]
}

export function ArticleBlocks({ blocks }: ArticleBlocksProps) {
  return (
    <div className='kb-reader-content'>
      {blocks.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: SourceBlock }) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 3)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3'
      return (
        <Tag id={block.id} className={`kb-h${level}`}>
          {block.text}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p id={block.id} className='kb-paragraph'>
          <Runs runs={block.runs} />
        </p>
      )
    case 'quote':
      return (
        <blockquote id={block.id} className='kb-quote'>
          <Runs runs={block.runs} />
        </blockquote>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag id={block.id} className={block.ordered ? 'kb-ol' : 'kb-ul'}>
          {block.items.map((item, i) => (
            // Items have no stable id of their own; index key is safe (read-only).
            <li key={i} className='kb-li'>
              <Runs runs={item} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre id={block.id} className='kb-code-block'>
          <code>{block.text}</code>
        </pre>
      )
    case 'image':
      return (
        <figure id={block.id} className='kb-reader-figure'>
          {/* Source images are remote and arbitrary-sized; a plain img with lazy
              loading is intentional (next/image needs configured domains). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.alt ?? ''} loading='lazy' />
          {block.caption && (
            <figcaption className='kb-reader-caption'>
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
    case 'table':
      return (
        <div id={block.id} className='kb-reader-table-wrap'>
          <table className='kb-reader-table'>
            {block.header && block.rows.length > 0 && (
              <thead>
                <tr>
                  {block.rows[0].map((cell, i) => (
                    <th key={i}>{cell}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(block.header ? block.rows.slice(1) : block.rows).map(
                (row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )
  }
}

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <Run key={i} run={run} />
      ))}
    </>
  )
}

const MARK_CLASS: Record<string, string> = {
  bold: 'kb-bold',
  italic: 'kb-italic',
  code: 'kb-text-code',
  strikethrough: 'kb-strikethrough',
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
