'use client'

import { useId, useMemo, useState } from 'react'

import {
  type ArticleBlockV2,
  type ArticleV2,
  type LearningAffordance,
  orderedBlocks,
} from '@/lib/article-v2'
import {
  deriveArticleSkeleton,
  isExampleBlock,
  isProseBlock,
  type OverviewTerm,
  type SectionSkeleton,
} from '@/lib/overview-skeleton'

import { DeepReadingBlock } from './deep-reading-block'

/**
 * Key-Term Overview Mode (DET-280) — the pre-reading orientation layer.
 *
 * Before the reader works through the prose, this surface shows the article's
 * conceptual *skeleton*: section headings stay crisp, each section's key terms
 * are surfaced as scannable chips, a one-line summary and any relationship
 * phrases are highlighted, secondary explanation prose is blurred/deemphasised
 * with the original layout preserved, and worked examples are collapsed. It is a
 * scaffolding technique — "first show the skeleton, then reveal the body" — not a
 * quiz: nothing here mints concepts or notes (a hard DET-280 non-goal).
 *
 * All surfaced terms/phrases are source-grounded — declared in the section's
 * `key_terms`/`concept_candidates` or lifted verbatim from the prose (see
 * `deriveSectionSkeleton`). Clicking a term previews where it occurs in the
 * article and the concept candidate it maps to; the CTA hands off to Deep
 * Reading Mode (DET-284) without losing the reader's place.
 */
export interface KeyTermOverviewProps {
  article: ArticleV2
  activeSectionId: string | null
  completedBySection: (sectionId: string) => Set<LearningAffordance>
}

export function KeyTermOverview({
  article,
  activeSectionId,
  completedBySection,
}: KeyTermOverviewProps) {
  const skeletons = useMemo(() => deriveArticleSkeleton(article), [article])
  const totalTerms = useMemo(
    () => skeletons.reduce((n, s) => n + s.keyTerms.length, 0),
    [skeletons],
  )
  // Deep Reading was folded into this surface: the skeleton blurs the prose and
  // each section unblurs in place. "Unblur all" reveals every section at once —
  // the same full content the separate Deep Reading mode used to show.
  const [revealAll, setRevealAll] = useState(false)

  return (
    <div className='kb-kto'>
      <div className='kb-kto-intro'>
        <p className='kb-kto-lede'>
          The skeleton first. Scan the headings and key terms to build a mental
          map, then unblur a section to fill in its detail. Explanatory prose is
          dimmed and examples folded away until you unblur.
        </p>
        <button
          type='button'
          className={`kb-kto-cta${revealAll ? ' is-on' : ''}`}
          aria-pressed={revealAll}
          onClick={() => setRevealAll((v) => !v)}
        >
          {revealAll ? 'Blur all' : 'Unblur all'}
          {!revealAll && <span aria-hidden='true'> →</span>}
        </button>
      </div>

      <ol className='kb-kto-sections'>
        {skeletons.map((skeleton, i) => (
          <OverviewSection
            key={skeleton.section.section_id}
            skeleton={skeleton}
            index={i + 1}
            isActive={skeleton.section.section_id === activeSectionId}
            completed={completedBySection(skeleton.section.section_id)}
            forceReveal={revealAll}
          />
        ))}
      </ol>

      <p className='kb-kto-foot'>
        {skeletons.length} sections · {totalTerms} key terms · a pre-reading
        map, not a quiz.
      </p>
    </div>
  )
}

interface OverviewSectionProps {
  skeleton: SectionSkeleton
  index: number
  isActive: boolean
  completed: Set<LearningAffordance>
  /** Force this section revealed (driven by the overview's "Unblur all"). */
  forceReveal: boolean
}

function OverviewSection({
  skeleton,
  index,
  isActive,
  completed,
  forceReveal,
}: OverviewSectionProps) {
  const { section, keyTerms, summarySentence, relationships } = skeleton
  const blocks = useMemo(() => orderedBlocks(section), [section])
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null)
  const [openExamples, setOpenExamples] = useState<Set<string>>(() => new Set())
  // Unblur this section in place — the fold that replaced Deep Reading. A local
  // toggle, or forced on by the overview-level "Unblur all".
  const [revealed, setRevealed] = useState(false)
  const isRevealed = forceReveal || revealed
  const previewId = useId()

  const active = keyTerms.find((t) => t.term === selectedTerm) ?? null

  const toggleExample = (blockId: string) =>
    setOpenExamples((prev) => {
      const next = new Set(prev)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      return next
    })

  return (
    <li
      className={`kb-kto-section${isActive ? ' is-active' : ''}`}
      aria-label={section.heading}
    >
      <div className='kb-kto-section-head'>
        <span className='kb-kto-num'>{String(index).padStart(2, '0')}</span>
        <button
          type='button'
          className='kb-kto-heading'
          onClick={() => setRevealed((r) => !r)}
          title={isRevealed ? 'Blur this section' : 'Unblur this section'}
        >
          {section.heading}
        </button>
        {completed.size > 0 && (
          <span
            className='kb-kto-done'
            aria-label={`${completed.size} learning actions done`}
          >
            ✓ {completed.size}
          </span>
        )}
      </div>

      {summarySentence && <p className='kb-kto-summary'>{summarySentence}</p>}

      {keyTerms.length > 0 && (
        <div
          className='kb-kto-terms'
          role='group'
          aria-label={`Key terms in ${section.heading}`}
        >
          {keyTerms.map((term) => {
            const isOpen = term.term === selectedTerm
            return (
              <button
                key={term.term}
                type='button'
                className={`kb-kto-term${isOpen ? ' is-open' : ''}`}
                aria-expanded={isOpen}
                aria-controls={isOpen ? previewId : undefined}
                onClick={() =>
                  setSelectedTerm((cur) =>
                    cur === term.term ? null : term.term,
                  )
                }
              >
                {term.term}
              </button>
            )
          })}
        </div>
      )}

      {active && (
        <TermPreview
          id={previewId}
          term={active}
          onReadInContext={() => setRevealed(true)}
        />
      )}

      {relationships.length > 0 && (
        <ul className='kb-kto-rels' aria-label='Key relationships'>
          {relationships.map((phrase) => (
            <li key={phrase} className='kb-kto-rel'>
              {phrase}
            </li>
          ))}
        </ul>
      )}

      <div className='kb-kto-blocks'>
        {blocks.map((block) => {
          if (block.type === 'heading' || block.type === 'divider') {
            // Structural blocks stay crisp — they're part of the skeleton.
            return <DeepReadingBlock key={block.block_id} block={block} />
          }
          if (isExampleBlock(block)) {
            // Unblurring a section opens its examples too, so the revealed
            // section shows the same full content the old Deep Reading mode did.
            const open = isRevealed || openExamples.has(block.block_id)
            return (
              <div key={block.block_id} className='kb-kto-example'>
                <button
                  type='button'
                  className='kb-kto-example-toggle'
                  aria-expanded={open}
                  onClick={() => toggleExample(block.block_id)}
                >
                  <span aria-hidden='true'>{open ? '▾' : '▸'}</span>
                  {open ? 'Hide' : 'Show'} {exampleLabel(block.type)}
                </button>
                {open && (
                  <div className='kb-kto-example-body'>
                    <DeepReadingBlock block={block} />
                  </div>
                )}
              </div>
            )
          }
          if (isProseBlock(block)) {
            // Secondary explanation: layout preserved, content blurred until the
            // section is unblurred. While blurred, `inert` takes the dimmed prose
            // out of the tab order and the a11y tree (so no focus lands on
            // blurred links and screen readers skip the decorative scaffold);
            // unblurring restores it to a normal, readable block.
            return (
              <div
                key={block.block_id}
                className={`kb-kto-prose${isRevealed ? ' is-revealed' : ''}`}
                inert={isRevealed ? undefined : true}
              >
                <DeepReadingBlock block={block} />
              </div>
            )
          }
          return <DeepReadingBlock key={block.block_id} block={block} />
        })}
      </div>

      {/* While "Unblur all" is on, the per-section toggle would be a no-op, so
          it's hidden — the overview-level control owns the reveal then. */}
      {!forceReveal && (
        <button
          type='button'
          className={`kb-kto-read${isRevealed ? ' is-on' : ''}`}
          aria-pressed={isRevealed}
          onClick={() => setRevealed((r) => !r)}
        >
          {isRevealed ? 'Blur section' : 'Unblur section'}
          {!isRevealed && <span aria-hidden='true'> →</span>}
        </button>
      )}
    </li>
  )
}

function TermPreview({
  id,
  term,
  onReadInContext,
}: {
  id: string
  term: OverviewTerm
  onReadInContext: () => void
}) {
  return (
    <div className='kb-kto-preview' id={id}>
      <p className='kb-kto-preview-term'>{term.term}</p>
      {term.conceptCandidate && (
        <p className='kb-kto-preview-concept'>
          <span className='kb-kto-preview-tag'>Concept candidate</span>
          {term.conceptCandidate.label}
        </p>
      )}
      {term.occurrence ? (
        <p className='kb-kto-preview-snippet'>{term.occurrence.snippet}</p>
      ) : (
        <p className='kb-kto-preview-snippet is-empty'>
          Appears in this section.
        </p>
      )}
      <button
        type='button'
        className='kb-kto-preview-read'
        onClick={onReadInContext}
      >
        Read in context
        <span aria-hidden='true'> →</span>
      </button>
    </div>
  )
}

function exampleLabel(type: ArticleBlockV2['type']): string {
  switch (type) {
    case 'code':
      return 'code example'
    case 'table':
      return 'table'
    case 'image':
      return 'figure'
    default:
      return 'example'
  }
}
