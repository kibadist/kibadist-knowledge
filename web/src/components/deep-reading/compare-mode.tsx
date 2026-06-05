'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ArticleLearningState } from '@/lib/article-learning-events'
import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  orderedBlocks,
  orderedSections,
} from '@/lib/article-v2'
import { compareRewrite, type RewriteComparison } from '@/lib/compare-repair'

import { CompareRepairBlock } from './compare-repair-block'

/**
 * Compare & Repair Mode (DET-286) — the mode-level host.
 *
 * The feedback mode that closes the active-recall loop. It consumes the
 * reconstructions the learner already submitted in Rewrite-the-Block Mode
 * (DET-285) — read straight from the one shared learning store — diffs each
 * against the article block it targets, and surfaces structured, source-faithful
 * feedback with an invitation to make one improved attempt.
 *
 * It owns event emission through the shared store and the DET-278 vocabulary for
 * this mode:
 *   - `comparison_generated` — structured feedback (preserved/missing/changed/
 *     unsupported + source confidence) for an answer vs. its block.
 *   - `rewrite_revised`      — the verbatim revised answer, saved as the new
 *     preferred user-authored explanation.
 *
 * Boundaries (DET-278 §4/§5): the comparison may *suggest* future practice
 * (claims worth re-testing), but it never schedules a review prompt and never
 * mints a concept or note. Source confidence is resolved here — a faithful answer
 * over a source-cited, source-available block is promoted to `source_supported`.
 */
export interface CompareModeProps {
  article: ArticleV2
  /** Shared learning-event store; all DET-286 events flow through it. */
  learning: ArticleLearningState
  /** Whether the original source spans behind the article are available. */
  sourceAvailable?: boolean
  /** Block to scroll to on entry (e.g. the block a section action targeted). */
  focusBlockId?: string | null
  /** Hand off to full guided reading (Deep Reading Mode). */
  onStartReading: () => void
}

interface CompareEntry {
  section: ArticleSectionV2
  block: ArticleBlockV2
  /** The verbatim rewrite the learner originally submitted (DET-285). */
  submitted: string
  /** The exact source snapshot stored on the rewrite, if any. */
  snapshot?: string
  index: number
  total: number
}

export function CompareMode({
  article,
  learning,
  sourceAvailable,
  focusBlockId,
  onStartReading,
}: CompareModeProps) {
  const sections = useMemo(() => orderedSections(article), [article])

  // Resolve a block_id to its block + section, defensively from persisted order.
  const blockIndex = useMemo(() => {
    const map = new Map<
      string,
      { section: ArticleSectionV2; block: ArticleBlockV2 }
    >()
    for (const section of sections) {
      for (const block of orderedBlocks(section)) {
        map.set(block.block_id, { section, block })
      }
    }
    return map
  }, [sections])

  // The latest submitted rewrite per block, read from the shared store. Later
  // submissions win, so a resubmitted block compares against its newest answer.
  const submittedByBlock = useMemo(() => {
    const map = new Map<string, string>()
    for (const event of learning.events) {
      if (
        event.event_type === 'block_rewrite_submitted' &&
        event.block_id &&
        typeof event.user_answer === 'string'
      ) {
        map.set(event.block_id, event.user_answer)
      }
    }
    return map
  }, [learning.events])

  // Local revision history per block (newest last). The original submitted
  // rewrite is version 0; each saved revision appends.
  const [revisionsByBlock, setRevisionsByBlock] = useState<
    Record<string, string[]>
  >({})

  // The ordered list of blocks that have a reconstruction to compare.
  const entries = useMemo<CompareEntry[]>(() => {
    const out: CompareEntry[] = []
    for (const section of sections) {
      const blocks = orderedBlocks(section).filter((b) =>
        submittedByBlock.has(b.block_id),
      )
      blocks.forEach((block, i) => {
        out.push({
          section,
          block,
          submitted: submittedByBlock.get(block.block_id) ?? '',
          snapshot: blockPlainText(block),
          index: i + 1,
          total: blocks.length,
        })
      })
    }
    return out
  }, [sections, submittedByBlock])

  const currentAnswer = useCallback(
    (blockId: string, fallback: string): string => {
      const revisions = revisionsByBlock[blockId]
      return revisions && revisions.length > 0
        ? revisions[revisions.length - 1]
        : fallback
    },
    [revisionsByBlock],
  )

  const computeComparison = useCallback(
    (block: ArticleBlockV2, answer: string): RewriteComparison =>
      compareRewrite(block, answer, {
        sourceAvailable,
        comparisonType: 'rewrite_vs_block',
      }),
    [sourceAvailable],
  )

  // Map a comparison to the shared structured-feedback contract (DET-278 §2/§5).
  const emitComparison = useCallback(
    (
      section: ArticleSectionV2,
      block: ArticleBlockV2,
      answer: string,
      comparison: RewriteComparison,
    ) => {
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        block_id: block.block_id,
        source_span_ids: block.source_span_ids,
        event_type: 'comparison_generated',
        user_answer: answer,
        ai_feedback: {
          summary: comparison.repair_prompt,
          preserved: comparison.preserved_claims,
          missing: comparison.missing_claims,
          changed_meaning: comparison.distorted_claims,
          unsupported: comparison.unsupported_claims,
          source_confidence: comparison.source_confidence,
        },
        metadata: {
          surface: 'compare_repair',
          comparison_type: comparison.comparison_type,
          block_type: block.type,
          detected_misconceptions: comparison.detected_misconceptions,
          source_faithfulness_score: comparison.source_faithfulness_score,
          understanding_score: comparison.understanding_score,
          revision_requested: comparison.revision_requested,
          source_block_snapshot: blockPlainText(block),
          // Claims worth re-testing later. Suggested only — Compare & Repair
          // never schedules a review prompt without validation (DET-278 §4).
          suggested_review: {
            status: 'suggested',
            claims: [
              ...comparison.missing_claims,
              ...comparison.distorted_claims,
            ],
          },
        },
      })
    },
    [article, learning],
  )

  // Emit the initial `comparison_generated` once per block that has a rewrite.
  const comparedRef = useRef(new Set<string>())
  useEffect(() => {
    for (const entry of entries) {
      if (comparedRef.current.has(entry.block.block_id)) continue
      comparedRef.current.add(entry.block.block_id)
      const answer = currentAnswer(entry.block.block_id, entry.submitted)
      emitComparison(
        entry.section,
        entry.block,
        answer,
        computeComparison(entry.block, answer),
      )
    }
  }, [entries, currentAnswer, computeComparison, emitComparison])

  const handleRevise = useCallback(
    (block: ArticleBlockV2, revised: string) => {
      const resolved = blockIndex.get(block.block_id)
      if (!resolved) return
      const { section } = resolved

      // Append the revision locally; the latest is the preferred answer.
      const versionNumber = (revisionsByBlock[block.block_id]?.length ?? 0) + 1
      setRevisionsByBlock((prev) => {
        const existing = prev[block.block_id] ?? []
        return { ...prev, [block.block_id]: [...existing, revised] }
      })

      // Verbatim revised answer — never paraphrased (DET-278 answer rule).
      learning.emit({
        article_id: article.article_id,
        article_version_id: article.article_version_id,
        section_id: section.section_id,
        block_id: block.block_id,
        source_span_ids: block.source_span_ids,
        event_type: 'rewrite_revised',
        user_answer: revised,
        ai_feedback: {
          source_confidence: computeComparison(block, revised)
            .source_confidence,
        },
        metadata: {
          surface: 'compare_repair',
          // The newest revision is the preferred user-authored explanation (AC).
          version: versionNumber,
          preferred: true,
          source_block_snapshot: blockPlainText(block),
        },
      })

      // Re-compare honestly against the revised answer.
      emitComparison(section, block, revised, computeComparison(block, revised))
    },
    [
      article,
      blockIndex,
      learning,
      revisionsByBlock,
      computeComparison,
      emitComparison,
    ],
  )

  const revisedCount = useMemo(
    () => Object.values(revisionsByBlock).filter((v) => v.length > 0).length,
    [revisionsByBlock],
  )

  if (entries.length === 0) {
    return (
      <div className='kb-cmp'>
        <div className='kb-cmp-empty'>
          <p className='kb-cmp-empty-lede'>
            Nothing to compare yet. Reconstruct a block in{' '}
            <strong>Rewrite</strong> first — your submitted reconstructions show
            up here, checked against the article block and its source.
          </p>
          <button type='button' className='kb-cmp-cta' onClick={onStartReading}>
            Back to reading
            <span aria-hidden='true'> →</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='kb-cmp'>
      <div className='kb-cmp-intro'>
        <p className='kb-cmp-lede'>
          See exactly where your version diverges from the article. For each
          reconstruction you submitted, this shows what you preserved, missed,
          or changed — and where you added something the block doesn&apos;t
          support. Then make one improved attempt.
        </p>
        <button type='button' className='kb-cmp-cta' onClick={onStartReading}>
          Back to reading
          <span aria-hidden='true'> →</span>
        </button>
      </div>

      <div className='kb-cmp-sections'>
        {sections
          .filter((section) =>
            entries.some((e) => e.section.section_id === section.section_id),
          )
          .map((section, si) => {
            const sectionEntries = entries.filter(
              (e) => e.section.section_id === section.section_id,
            )
            return (
              <section
                key={section.section_id}
                className='kb-cmp-section'
                aria-label={section.heading}
              >
                <header className='kb-cmp-section-head'>
                  <span className='kb-cmp-section-num'>
                    {String(si + 1).padStart(2, '0')}
                  </span>
                  <h2 className='kb-cmp-section-title kb-h2'>
                    {section.heading}
                  </h2>
                </header>

                {sectionEntries.map((entry) => {
                  const answer = currentAnswer(
                    entry.block.block_id,
                    entry.submitted,
                  )
                  const revisions = revisionsByBlock[entry.block.block_id] ?? []
                  return (
                    <CompareRepairBlock
                      key={entry.block.block_id}
                      block={entry.block}
                      index={entry.index}
                      total={entry.total}
                      currentAnswer={answer}
                      revisionCount={revisions.length}
                      comparison={computeComparison(entry.block, answer)}
                      onRevise={handleRevise}
                      autoFocus={entry.block.block_id === focusBlockId}
                    />
                  )
                })}
              </section>
            )
          })}
      </div>

      <p className='kb-cmp-foot'>
        {entries.length} reconstruction{entries.length === 1 ? '' : 's'} ·{' '}
        {revisedCount} revised · feedback stays as activity, not notes.
      </p>
    </div>
  )
}
