'use client'

import { useCallback, useMemo } from 'react'

import type { ArticleLearningState } from '@/lib/article-learning-events'
import {
  type ArticleSectionV2,
  type ArticleV2,
  orderedBlocks,
  orderedSections,
} from '@/lib/article-v2'
import {
  REWRITE_PROMPT,
  type RewritableBlock,
  type RewriteMetrics,
  rewritableBlocks,
  sourceBlockSnapshot,
} from '@/lib/rewrite-block'

import { RewriteBlock } from './rewrite-block'

/**
 * Rewrite-the-Block Mode (DET-285) — the mode-level host.
 *
 * The core active-recall mode for generated articles: section by section, the
 * learner reconstructs each text-bearing block from memory while the source is
 * blurred. This host owns event emission through the one shared learning store
 * (so the reading surface's completion markers stay honest) and the DET-278
 * event vocabulary for this mode:
 *   - `block_rewrite_started`   — the learner focused a block's editor.
 *   - `rewrite_peeked`          — the learner explicitly revealed the source.
 *   - `block_rewrite_submitted` — the verbatim rewrite + source snapshot + metrics.
 *
 * Provenance (DET-278 §5): a fresh rewrite is `user_authored_unsourced` — this
 * mode never claims source support; that is Compare & Repair's job (DET-286).
 * Rewrites never become notes, concepts, or scheduled prompts here (DET-278 §4).
 */
export interface RewriteModeProps {
  article: ArticleV2
  /** Shared learning-event store; all DET-285 events flow through it. */
  learning: ArticleLearningState
  /** Block to scroll to on entry (e.g. the block a section action targeted). */
  focusBlockId?: string | null
  /** Hand off to full guided reading (Deep Reading Mode). */
  onStartReading: () => void
}

interface RewriteEntry {
  section: ArticleSectionV2
  block: RewritableBlock
  index: number
  total: number
}

export function RewriteMode({
  article,
  learning,
  focusBlockId,
  onStartReading,
}: RewriteModeProps) {
  const sections = useMemo(() => orderedSections(article), [article])

  // Pre-compute, per section, the ordered rewritable blocks and their 1-based
  // position so each card can show "Block i of n" within its section.
  const sectionEntries = useMemo(
    () =>
      sections.map((section) => {
        const blocks = rewritableBlocks(orderedBlocks(section))
        const entries: RewriteEntry[] = blocks.map((block, i) => ({
          section,
          block,
          index: i + 1,
          total: blocks.length,
        }))
        return { section, entries }
      }),
    [sections],
  )

  const rewritableCount = useMemo(
    () => sectionEntries.reduce((n, s) => n + s.entries.length, 0),
    [sectionEntries],
  )

  const handleStart = useCallback(
    (section: ArticleSectionV2, block: RewritableBlock) => {
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        block_id: block.block_id,
        source_span_ids: block.source_span_ids,
        event_type: 'block_rewrite_started',
        prompt: REWRITE_PROMPT,
        metadata: {
          surface: 'rewrite_block',
          block_type: block.type,
          // Pin the exact source the learner is reconstructing from.
          source_block_snapshot: sourceBlockSnapshot(block),
        },
      })
    },
    [article, learning],
  )

  const handlePeek = useCallback(
    (section: ArticleSectionV2, block: RewritableBlock, peekIndex: number) => {
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        block_id: block.block_id,
        source_span_ids: block.source_span_ids,
        event_type: 'rewrite_peeked',
        metadata: {
          surface: 'rewrite_block',
          block_type: block.type,
          peek_count: peekIndex,
        },
      })
    },
    [article, learning],
  )

  const handleSubmit = useCallback(
    (
      section: ArticleSectionV2,
      block: RewritableBlock,
      rewrite: string,
      metrics: RewriteMetrics,
    ) => {
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        block_id: block.block_id,
        source_span_ids: block.source_span_ids,
        event_type: 'block_rewrite_submitted',
        prompt: REWRITE_PROMPT,
        // Verbatim — never paraphrased (DET-278 user-authored answer rule).
        user_answer: rewrite,
        ai_feedback: {
          // A fresh rewrite carries no source comparison yet (DET-278 §5).
          source_confidence: 'user_authored_unsourced',
        },
        metadata: {
          surface: 'rewrite_block',
          block_type: block.type,
          source_block_snapshot: sourceBlockSnapshot(block),
          peek_count: metrics.peek_count,
          editor_focus_duration_ms: metrics.editor_focus_duration_ms,
          time_before_first_peek_ms: metrics.time_before_first_peek_ms,
          word_count: metrics.word_count,
        },
      })
    },
    [article, learning],
  )

  // Which blocks already have a submitted rewrite this session (drives the
  // submitted state + completion badges, derived from the shared store).
  const submittedBlockIds = useMemo(() => {
    const ids = new Set<string>()
    for (const event of learning.events) {
      if (event.event_type === 'block_rewrite_submitted' && event.block_id) {
        ids.add(event.block_id)
      }
    }
    return ids
  }, [learning.events])

  const submittedCount = submittedBlockIds.size

  return (
    <div className='kb-rw'>
      <div className='kb-rw-intro'>
        <p className='kb-rw-lede'>
          Prove you can regenerate the meaning. For each block, write your own
          version from memory — the source blurs the moment you start writing so
          you can&apos;t copy it. Peek if you must; it&apos;s tracked.
          Submitting saves your rewrite for Compare &amp; Repair.
        </p>
        <button type='button' className='kb-rw-cta' onClick={onStartReading}>
          Back to reading
          <span aria-hidden='true'> →</span>
        </button>
      </div>

      <div className='kb-rw-sections'>
        {sectionEntries.map(({ section, entries }, si) => (
          <section
            key={section.section_id}
            className='kb-rw-section'
            aria-label={section.heading}
          >
            <header className='kb-rw-section-head'>
              <span className='kb-rw-section-num'>
                {String(si + 1).padStart(2, '0')}
              </span>
              <h2 className='kb-rw-section-title kb-h2'>{section.heading}</h2>
            </header>

            {entries.length === 0 ? (
              <p className='kb-rw-empty'>
                Nothing to reconstruct here — this section has no text blocks.
              </p>
            ) : (
              entries.map((entry) => (
                <RewriteBlock
                  key={entry.block.block_id}
                  article={article}
                  section={section}
                  block={entry.block}
                  index={entry.index}
                  total={entry.total}
                  submitted={submittedBlockIds.has(entry.block.block_id)}
                  autoFocus={entry.block.block_id === focusBlockId}
                  onStart={(block) => handleStart(section, block)}
                  onPeek={(block, peekIndex) =>
                    handlePeek(section, block, peekIndex)
                  }
                  onSubmit={(block, rewrite, metrics) =>
                    handleSubmit(section, block, rewrite, metrics)
                  }
                />
              ))
            )}
          </section>
        ))}
      </div>

      <p className='kb-rw-foot'>
        {rewritableCount} block{rewritableCount === 1 ? '' : 's'} ·{' '}
        {submittedCount} rewritten · rewrites stay as activity, not notes.
      </p>
    </div>
  )
}
