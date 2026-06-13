'use client'

import {
  confidenceChip,
  type SourceTrace,
  type SourceTraceIndex,
} from '@/lib/source-trace'
import { fidelityRiskChip, severityChip } from '@/lib/transformer-format'

import './source-trace.css'

/**
 * The provenance appendix (DET-358) — below the article body, it exposes the
 * source-grounded artifacts that aren't inline blocks: claims, AI concepts +
 * candidates, retrieval prompts, and the fidelity quality warnings. Every row is
 * a button that opens the same source-trace drawer the inline blocks use, so a
 * reader can chase any generated artifact back to its source. Unsupported /
 * high-risk rows are visually distinct (a contested chip + a left accent).
 */
export function ProvenancePanel({
  index,
  onInspect,
}: {
  index: SourceTraceIndex
  onInspect: (trace: SourceTrace) => void
}) {
  return (
    <section className='kb-prov' aria-label='Provenance'>
      <div className='kb-prov-head'>
        <span className='kb-prov-kicker'>Provenance</span>
        <p className='kb-prov-sub'>
          Where this article came from — trace any claim, concept, prompt or
          warning back to the source blocks it derives from.
        </p>
      </div>

      <TraceGroup
        title='Claims'
        empty='No source-grounded claims surfaced.'
        traces={index.claims}
        onInspect={onInspect}
      />
      <TraceGroup
        title='Concepts'
        empty='No concepts extracted yet.'
        traces={index.concepts}
        onInspect={onInspect}
      />
      <TraceGroup
        title='Concept candidates'
        empty='No concept candidates extracted yet.'
        traces={index.conceptCandidates}
        onInspect={onInspect}
        withSection
      />
      <TraceGroup
        title='Retrieval prompts'
        empty='No retrieval prompts generated yet.'
        traces={index.retrievalPrompts}
        onInspect={onInspect}
      />
      <TraceGroup
        title='Quality warnings'
        empty='No fidelity warnings — the reshape held up against the source.'
        traces={index.qualityWarnings}
        onInspect={onInspect}
        warning
      />
    </section>
  )
}

function TraceGroup({
  title,
  empty,
  traces,
  onInspect,
  withSection = false,
  warning = false,
}: {
  title: string
  empty: string
  traces: SourceTrace[]
  onInspect: (trace: SourceTrace) => void
  /** Show the article section a candidate belongs to. */
  withSection?: boolean
  /** This group lists fidelity warnings (severity-toned). */
  warning?: boolean
}) {
  return (
    <div className='kb-prov-group'>
      <h3 className='kb-prov-h'>
        {title}
        {traces.length > 0 && (
          <span className='kb-prov-count'>{traces.length}</span>
        )}
      </h3>
      {traces.length === 0 ? (
        <p className='kb-prov-empty'>{empty}</p>
      ) : (
        <ul className='kb-prov-list'>
          {traces.map((t) => (
            <li key={t.id}>
              <button
                type='button'
                className={`kb-prov-row${t.unsupported ? ' is-unsupported' : ''}`}
                onClick={() => onInspect(t)}
              >
                <span className='kb-prov-row-text'>{t.generatedText}</span>
                <span className='kb-prov-row-meta'>
                  {withSection && t.sectionHeading && (
                    <span className='kb-prov-row-section'>
                      § {t.sectionHeading}
                    </span>
                  )}
                  {warning && t.severity ? (
                    <span className={`chip ${severityChip(t.severity)}`}>
                      {t.severity}
                    </span>
                  ) : t.fidelityRisk ? (
                    <span
                      className={`chip ${fidelityRiskChip(t.fidelityRisk)}`}
                    >
                      {t.fidelityRisk} risk
                    </span>
                  ) : (
                    <span className={`chip ${confidenceChip(t.confidence)}`}>
                      {t.confidence}
                    </span>
                  )}
                  {t.unsupported ? (
                    <span className='chip chip-contested'>unsupported</span>
                  ) : (
                    <span className='kb-prov-row-srccount'>
                      {t.sourceBlocks.length} source
                      {t.sourceBlocks.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
