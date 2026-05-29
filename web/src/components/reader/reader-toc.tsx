'use client'

import { useEffect, useState } from 'react'

import type { ReaderHeading } from './reader-content'

export interface ReaderTocProps {
  headings: ReaderHeading[]
}

/**
 * Table of contents for longer articles (DET-209). Only meaningful when the
 * source actually has headings; the Reader hides it otherwise. Clicking a item
 * smooth-scrolls to the heading, and the current section is highlighted as the
 * reader scrolls.
 */
export function ReaderToc({ headings }: ReaderTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (headings.length === 0) return
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el != null)
    if (elements.length === 0) return

    // Highlight the topmost heading currently in (or just above) the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActiveId(visible[0].target.id)
      },
      // Bias toward the upper part of the viewport so the active item tracks
      // what the reader is actually looking at.
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [headings])

  if (headings.length < 2) return null

  // Indent levels relative to the shallowest heading present.
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <nav aria-label='Table of contents' className='kb-reader-toc'>
      <p className='kb-reader-toc-title'>On this page</p>
      <ul>
        {headings.map((h) => (
          <li
            key={h.id}
            style={{ paddingLeft: `${(h.level - minLevel) * 0.75}rem` }}
          >
            <a
              href={`#${h.id}`}
              className={activeId === h.id ? 'is-active' : undefined}
              onClick={(e) => {
                e.preventDefault()
                const el = document.getElementById(h.id)
                if (el) {
                  const reduceMotion = window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                  el.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start',
                  })
                  setActiveId(h.id)
                }
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
