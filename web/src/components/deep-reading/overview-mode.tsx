'use client'

import {
  type ArticleV2,
  type LearningAffordance,
  orderedSections,
  sectionKeyTerms,
} from '@/lib/article-v2'

/**
 * Overview Mode — the article skeleton shown before/between deep reading
 * (DET-284 mode toggle; the full key-term overview experience is DET-280).
 *
 * This lightweight version lists the sections, their key terms, and how much
 * active learning the reader has already done in each. Selecting a section
 * switches to Deep Reading Mode anchored at that section, which is what keeps
 * reading position stable across the toggle.
 */
export interface OverviewModeProps {
  article: ArticleV2
  activeSectionId: string | null
  completedBySection: (sectionId: string) => Set<LearningAffordance>
  onSelectSection: (sectionId: string) => void
}

export function OverviewMode({
  article,
  activeSectionId,
  completedBySection,
  onSelectSection,
}: OverviewModeProps) {
  const sections = orderedSections(article)

  return (
    <div className='kb-dr-overview'>
      <p className='kb-dr-overview-lede'>
        The article at a glance. Pick a section to read it in full — your place
        is kept when you switch back.
      </p>
      <ol className='kb-dr-overview-list'>
        {sections.map((section, i) => {
          const terms = sectionKeyTerms(section)
          const completed = completedBySection(section.section_id)
          const isActive = section.section_id === activeSectionId
          return (
            <li key={section.section_id}>
              <button
                type='button'
                className={`kb-dr-overview-item${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectSection(section.section_id)}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className='kb-dr-overview-num'>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className='kb-dr-overview-body'>
                  <span className='kb-dr-overview-heading'>
                    {section.heading}
                    {completed.size > 0 && (
                      <span
                        className='kb-dr-overview-done'
                        aria-label={`${completed.size} learning actions done`}
                      >
                        ✓ {completed.size}
                      </span>
                    )}
                  </span>
                  {terms.length > 0 && (
                    <span className='kb-dr-overview-terms'>
                      {terms.slice(0, 6).map((t) => (
                        <span key={t.term} className='kb-dr-overview-term'>
                          {t.term}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
