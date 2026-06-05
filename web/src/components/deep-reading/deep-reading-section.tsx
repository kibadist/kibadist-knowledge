'use client'

import { useMemo } from 'react'

import {
  type ArticleSectionV2,
  type ArticleV2,
  type LearningAffordance,
  orderedBlocks,
  sectionAffordances,
  sectionKeyTerms,
} from '@/lib/article-v2'

import { DeepReadingBlock } from './deep-reading-block'
import { SectionActions, SectionCompletionMarkers } from './section-actions'
import {
  AFFORDANCE_HANDLER,
  type BlockContext,
  type LearningModeHandlers,
  type SectionContext,
} from './types'

/**
 * One article section in Deep Reading Mode (DET-284): the prose, plus the quiet
 * affordances that turn reading into recall. The action bar stays subtle until
 * the section is hovered/focused or the reader reaches its end; completion
 * markers show which active-learning actions the reader has already done here.
 */
export interface DeepReadingSectionProps {
  article: ArticleV2
  section: ArticleSectionV2
  /** 1-based position for the section eyebrow. */
  index: number
  total: number
  completed: Set<LearningAffordance>
  handlers: LearningModeHandlers
  /** Highlight key terms inside the prose. */
  highlightKeyTerms: boolean
  onAffordance: (affordance: LearningAffordance, ctx: SectionContext) => void
  /** Ref-setter so the hub can observe sections for active-section tracking. */
  registerRef: (sectionId: string, el: HTMLElement | null) => void
}

export function DeepReadingSection({
  article,
  section,
  index,
  total,
  completed,
  handlers,
  highlightKeyTerms,
  onAffordance,
  registerRef,
}: DeepReadingSectionProps) {
  const blocks = useMemo(() => orderedBlocks(section), [section])
  const keyTerms = useMemo(() => sectionKeyTerms(section), [section])
  const affordances = useMemo(() => sectionAffordances(section), [section])
  const termStrings = useMemo(
    () => (highlightKeyTerms ? keyTerms.map((k) => k.term) : []),
    [highlightKeyTerms, keyTerms],
  )

  // The block a block-scoped action (Rewrite/Compare) targets: the first
  // text-bearing block of the section.
  const primaryBlock = useMemo(
    () =>
      blocks.find(
        (b) =>
          b.type === 'paragraph' ||
          b.type === 'quote' ||
          b.type === 'list' ||
          b.type === 'callout',
      ) ?? blocks[0],
    [blocks],
  )

  const ctx: SectionContext = { article, section }

  const isAvailable = (affordance: LearningAffordance) =>
    Boolean(handlers[AFFORDANCE_HANDLER[affordance]])

  const handleAction = (affordance: LearningAffordance) => {
    // Block-scoped modes get a BlockContext; section-scoped modes a SectionContext.
    if (affordance === 'rewrite' && handlers.onRewrite && primaryBlock) {
      const blockCtx: BlockContext = { ...ctx, block: primaryBlock }
      handlers.onRewrite(blockCtx)
    } else if (affordance === 'compare' && handlers.onCompare && primaryBlock) {
      const blockCtx: BlockContext = { ...ctx, block: primaryBlock }
      handlers.onCompare(blockCtx)
    } else if (affordance === 'predict') {
      handlers.onPredict?.(ctx)
    } else if (affordance === 'extract_concepts') {
      handlers.onExtractConcepts?.(ctx)
    } else if (affordance === 'review') {
      handlers.onReview?.(ctx)
    }
    onAffordance(affordance, ctx)
  }

  return (
    <section
      id={section.section_id}
      ref={(el) => registerRef(section.section_id, el)}
      className={`kb-dr-section${completed.size > 0 ? ' is-touched' : ''}`}
      aria-label={section.heading}
    >
      <header className='kb-dr-section-head'>
        <p className='kb-dr-section-eyebrow'>
          <span className='kb-dr-section-num'>
            {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
          {completed.size > 0 && (
            <span className='kb-dr-section-badge' aria-hidden='true'>
              ✓ {completed.size}
            </span>
          )}
        </p>
        <h2 className='kb-dr-section-title kb-h2'>{section.heading}</h2>
      </header>

      <div className='kb-reader-content kb-dr-prose'>
        {blocks.map((block) => (
          <DeepReadingBlock
            key={block.block_id}
            block={block}
            keyTerms={termStrings}
          />
        ))}
      </div>

      <SectionCompletionMarkers completed={completed} />

      <footer className='kb-dr-section-foot'>
        <SectionActions
          affordances={affordances}
          completed={completed}
          onAction={handleAction}
          isAvailable={isAvailable}
        />
      </footer>
    </section>
  )
}
