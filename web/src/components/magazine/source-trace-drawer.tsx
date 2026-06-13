'use client'

import { useEffect } from 'react'

import {
  confidenceChip,
  confidenceLabel,
  type SourceTrace,
} from '@/lib/source-trace'
import {
  blockClassChip,
  fidelityRiskChip,
  severityChip,
  transformationTypeLabel,
} from '@/lib/transformer-format'

import './source-trace.css'

/**
 * The source-trace drawer (DET-358) — a slide-in right rail that inspects one
 * generated fragment's provenance: the transformation type, fidelity risk and
 * (derived) confidence; the generated article text; and every source block it
 * derives from, rendered in ORIGINAL source order with a preview, classification,
 * and location. A fragment with no resolvable source falls back to a loud
 * "unsupported" warning state.
 *
 * Source block ids are HIDDEN from normal readers and only revealed in debug
 * mode (`?debug=1`) — the reader sees source text + provenance, the operator
 * sees the raw ids needed to chase a broken link.
 */
export function SourceTraceDrawer({
  trace,
  debug = false,
  onClose,
}: {
  trace: SourceTrace | null
  /** Reveal raw source-block ids (operator view). */
  debug?: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!trace) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trace, onClose])

  if (!trace) return null

  const highRisk = trace.fidelityRisk === 'high' || trace.confidence === 'low'

  return (
    <>
      <button
        type='button'
        className='kb-trace-scrim'
        aria-label='Close source trace'
        onClick={onClose}
      />
      <aside
        className={`kb-trace${trace.unsupported ? ' is-unsupported' : highRisk ? ' is-highrisk' : ''}`}
        aria-label='Source trace'
      >
        <div className='kb-trace-head'>
          <span className='kb-trace-kicker'>{trace.label} · source trace</span>
          <button
            type='button'
            className='kb-trace-close'
            onClick={onClose}
            aria-label='Close'
          >
            ✕
          </button>
        </div>

        <div className='kb-trace-chips'>
          {trace.transformationType && (
            <span className='chip chip-info'>
              {transformationTypeLabel(trace.transformationType)}
            </span>
          )}
          {trace.fidelityRisk && (
            <span className={`chip ${fidelityRiskChip(trace.fidelityRisk)}`}>
              {trace.fidelityRisk} fidelity risk
            </span>
          )}
          {trace.severity && trace.kind === 'qualityWarning' && (
            <span className={`chip ${severityChip(trace.severity)}`}>
              {trace.severity} severity
            </span>
          )}
          <span className={`chip ${confidenceChip(trace.confidence)}`}>
            {confidenceLabel(trace.confidence)}
          </span>
          {trace.unsupported && (
            <span className='chip chip-contested'>unsupported</span>
          )}
        </div>

        {trace.sectionHeading && (
          <p className='kb-trace-section'>
            In section · {trace.sectionHeading}
          </p>
        )}
        {trace.articleRef && (
          <p className='kb-trace-ref'>
            Article ref ·{' '}
            <a href={`#${trace.articleRef}`} onClick={onClose}>
              {trace.articleRef}
            </a>
          </p>
        )}

        <section className='kb-trace-block'>
          <h4 className='kb-trace-h'>
            {trace.kind === 'qualityWarning'
              ? 'Finding'
              : 'Generated article text'}
          </h4>
          <p className='kb-trace-generated'>{trace.generatedText}</p>
        </section>

        {trace.unsupported ? (
          <p className='notice notice-error kb-trace-warn'>
            No source could be traced for this {trace.label.toLowerCase()} — it
            is unsupported by the captured source.
            {debug && trace.sourceBlockIds.length > 0 && (
              <>
                {' '}
                Claimed ids:{' '}
                <span className='kb-trace-ids'>
                  {trace.sourceBlockIds.join(', ')}
                </span>
                .
              </>
            )}
          </p>
        ) : (
          <section className='kb-trace-block'>
            <h4 className='kb-trace-h'>
              Original source{trace.sourceBlocks.length > 1 ? 's' : ''}
              {trace.kind === 'retrievalPrompt' && ' · expected answer'}
            </h4>
            {trace.sourceBlocks.map((b) => (
              <figure key={b.id} className='kb-trace-source'>
                <blockquote>{b.text}</blockquote>
                <figcaption>
                  {b.classificationLabel && (
                    <span
                      className={`chip ${blockClassChip(b.classification)}`}
                    >
                      {b.classificationLabel}
                    </span>
                  )}
                  {b.location && (
                    <span className='kb-trace-loc'>{b.location}</span>
                  )}
                  {debug && <span className='kb-trace-id'>{b.id}</span>}
                </figcaption>
              </figure>
            ))}
            {trace.missingBlockIds.length > 0 && (
              <p className='notice notice-error kb-trace-warn'>
                {trace.missingBlockIds.length} referenced block
                {trace.missingBlockIds.length > 1 ? 's' : ''} could not be
                resolved against this source version
                {debug && (
                  <>
                    {' '}
                    (
                    <span className='kb-trace-ids'>
                      {trace.missingBlockIds.join(', ')}
                    </span>
                    )
                  </>
                )}
                .
              </p>
            )}
          </section>
        )}
      </aside>
    </>
  )
}
