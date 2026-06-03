'use client'

import { useState } from 'react'

import type { CoverageReport, TransformerBlockView } from '@/lib/api'
import { blockClassLabel } from '@/lib/transformer-format'

/**
 * Coverage panel (DET-255): how much of the source the article represents.
 * Shows the coverage percent + counts, with expandable lists for represented /
 * removed (with reasons) / uncertain / unrepresented blocks. Block ids resolve to
 * a short preview via the source's blocks list.
 */
export function CoveragePanel({
  coverage,
  blocksById,
}: {
  coverage: CoverageReport
  blocksById: Map<string, TransformerBlockView>
}) {
  const preview = (id: string): string => {
    const b = blocksById.get(id)
    if (!b) return `Block ${id} (unresolved)`
    return b.text.length > 120 ? `${b.text.slice(0, 120)}…` : b.text
  }

  return (
    <section className='panel tf-coverage'>
      <div className='tf-coverage-head'>
        <h3 className='panel-h'>Source coverage</h3>
        <div className='tf-coverage-pct'>
          <span className='tf-coverage-num'>{coverage.coveragePercent}%</span>
          <span className='tf-coverage-of'>
            of {coverage.totalBlocks} source blocks represented
          </span>
        </div>
      </div>

      <div className='tf-coverage-bar'>
        <div
          className='tf-coverage-fill'
          style={{
            width: `${Math.min(100, Math.max(0, coverage.coveragePercent))}%`,
          }}
        />
      </div>

      <CoverageGroup
        label='Represented'
        tone='cleared'
        ids={coverage.representedBlockIds}
        render={(id) => <span className='tf-cov-text'>{preview(id)}</span>}
      />

      <CoverageGroup
        label='Removed'
        tone='contested'
        ids={coverage.removedBlocks.map((r) => r.blockId)}
        render={(id) => {
          const reason = coverage.removedBlocks.find(
            (r) => r.blockId === id,
          )?.reason
          return (
            <>
              <span className='tf-cov-text'>{preview(id)}</span>
              {reason && <span className='tf-cov-reason'>{reason}</span>}
            </>
          )
        }}
      />

      <CoverageGroup
        label='Uncertain'
        tone='pending'
        ids={coverage.uncertainBlockIds}
        render={(id) => {
          const b = blocksById.get(id)
          return (
            <>
              <span className='tf-cov-text'>{preview(id)}</span>
              {b?.classification && (
                <span className='tf-cov-reason'>
                  {blockClassLabel(b.classification)}
                </span>
              )}
            </>
          )
        }}
      />

      <CoverageGroup
        label='Unrepresented'
        tone='quiet'
        ids={coverage.unrepresentedBlockIds}
        render={(id) => <span className='tf-cov-text'>{preview(id)}</span>}
      />
    </section>
  )
}

function CoverageGroup({
  label,
  tone,
  ids,
  render,
}: {
  label: string
  tone: 'cleared' | 'contested' | 'pending' | 'quiet'
  ids: string[]
  render: (id: string) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className='tf-cov-group'>
      <button
        type='button'
        className='tf-cov-toggle'
        onClick={() => setOpen((o) => !o)}
        disabled={ids.length === 0}
        aria-expanded={open}
      >
        <span className={`chip chip-${tone}`}>{label}</span>
        <span className='tf-cov-count'>{ids.length}</span>
        {ids.length > 0 && (
          <span className='tf-cov-caret'>{open ? '−' : '+'}</span>
        )}
      </button>
      {open && (
        <ul className='tf-cov-list'>
          {ids.map((id) => (
            <li key={id} className='tf-cov-item'>
              {render(id)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
