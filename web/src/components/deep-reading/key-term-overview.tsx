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
  /** Enter Deep Reading anchored at a section (optionally a specific block). */
  onSelectSection: (sectionId: string, blockId?: string) => void
  /** Primary CTA: begin guided reading from the current position. */
  onStartReading: () => void
}

export function KeyTermOverview({
  article,
  activeSectionId,
  completedBySection,
  onSelectSection,
  onStartReading,
}: KeyTermOverviewProps) {
  const skeletons = useMemo(() => deriveArticleSkeleton(article), [article])
  const totalTerms = useMemo(
    () => skeletons.reduce((n, s) => n + s.keyTerms.length, 0),
    [skeletons],
  )

  return (
    <div className='kb-kto'>
      <div className='kb-kto-intro'>
        <p className='kb-kto-lede'>
          The skeleton first. Scan the headings and key terms to build a mental
          map, then start guided reading to fill in the detail. Explanatory
          prose is dimmed and examples are folded away until you read.
        </p>
        <button type='button' className='kb-kto-cta' onClick={onStartReading}>
          Start guided reading
          <span aria-hidden='true'> →</span>
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
            onSelectSection={onSelectSection}
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
  onSelectSection: (sectionId: string, blockId?: string) => void
}

function OverviewSection({
  skeleton,
  index,
  isActive,
  completed,
  onSelectSection,
}: OverviewSectionProps) {
  const { section, keyTerms, summarySentence, relationships } = skeleton
  const blocks = useMemo(() => orderedBlocks(section), [section])
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null)
  const [openExamples, setOpenExamples] = useState<Set<string>>(() => new Set())
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
          onClick={() => onSelectSection(section.section_id)}
          title='Read this section'
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
          onReadInContext={() =>
            onSelectSection(section.section_id, active.occurrence?.block_id)
          }
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
            const open = openExamples.has(block.block_id)
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
            // Secondary explanation: layout preserved, content blurred. `inert`
            // takes the dimmed prose out of the tab order and the a11y tree (so
            // no focus lands on blurred links and screen readers skip the
            // decorative scaffold); the full text is read in Deep Reading Mode.
            return (
              <div key={block.block_id} className='kb-kto-prose' inert>
                <DeepReadingBlock block={block} />
              </div>
            )
          }
          return <DeepReadingBlock key={block.block_id} block={block} />
        })}
      </div>

      <button
        type='button'
        className='kb-kto-read'
        onClick={() => onSelectSection(section.section_id)}
      >
        Start guided reading from here
        <span aria-hidden='true'> →</span>
      </button>
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
