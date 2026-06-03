'use client'

import { useEffect } from 'react'

import type { TransformationType, TransformerBlockView } from '@/lib/api'
import {
  blockClassChip,
  blockClassLabel,
  blockLocationLine,
  fidelityRiskChip,
  transformationTypeLabel,
} from '@/lib/transformer-format'

// What the inspector is currently showing: a transformed fragment (a paragraph,
// a key term, a caveat, a concept…) and the source blocks it claims to derive
// from. `transformationType`/`fidelityRisk` are only present for body paragraphs.
export interface InspectorSelection {
  // A short kind label rendered in the eyebrow ("Paragraph", "Key term"…).
  kind: string
  // The transformed text shown at the top (the thing being audited).
  transformedText: string
  sourceBlockIds: string[]
  transformationType?: TransformationType
  fidelityRisk?: 'low' | 'medium' | 'high'
}

/**
 * DET-257 source inspector. A slide-in right rail that audits one transformed
 * fragment against its source: the transformed text vs each referenced original
 * block (clearly distinguished with an "Original source" label + quote styling),
 * the transformation type + fidelity risk, and the source location (page / char
 * range / URL). Blocks are resolved by id from the source's blocks list.
 */
export function SourceInspectorPanel({
  selection,
  blocksById,
  sourceUrl,
  onClose,
}: {
  selection: InspectorSelection | null
  blocksById: Map<string, TransformerBlockView>
  sourceUrl: string | null
  onClose: () => void
}) {
  // Close on Escape — a standard side-panel affordance.
  useEffect(() => {
    if (!selection) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onClose])

  if (!selection) return null

  const referenced = selection.sourceBlockIds
    .map((id) => blocksById.get(id))
    .filter((b): b is TransformerBlockView => Boolean(b))
  // Ids that were claimed but couldn't be resolved against the pinned blocks.
  const missingIds = selection.sourceBlockIds.filter(
    (id) => !blocksById.has(id),
  )

  return (
    <>
      <button
        type='button'
        className='tf-scrim'
        aria-label='Close source inspector'
        onClick={onClose}
      />
      <aside className='tf-inspector' aria-label='Source inspector'>
        <div className='tf-inspector-head'>
          <span className='mono-label'>{selection.kind} · source audit</span>
          <button
            type='button'
            className='tf-inspector-close'
            onClick={onClose}
            aria-label='Close'
          >
            ✕
          </button>
        </div>

        <div className='tf-inspector-chips'>
          {selection.transformationType && (
            <span className='chip chip-info'>
              {transformationTypeLabel(selection.transformationType)}
            </span>
          )}
          {selection.fidelityRisk && (
            <span
              className={`chip ${fidelityRiskChip(selection.fidelityRisk)}`}
            >
              {selection.fidelityRisk} fidelity risk
            </span>
          )}
        </div>

        <section className='tf-inspector-block'>
          <h4 className='tf-inspector-h'>Transformed</h4>
          <p className='tf-inspector-transformed'>
            {selection.transformedText}
          </p>
        </section>

        {selection.sourceBlockIds.length === 0 ? (
          <p className='notice notice-error'>
            Missing source reference — this fragment carries no source block ids
            and cannot be traced.
          </p>
        ) : (
          <section className='tf-inspector-block'>
            <h4 className='tf-inspector-h'>
              Original source{referenced.length > 1 ? 's' : ''}
            </h4>
            {referenced.map((block) => {
              const loc = blockLocationLine(block)
              return (
                <figure key={block.id} className='tf-source-quote'>
                  <blockquote>{block.text}</blockquote>
                  <figcaption>
                    <span
                      className={`chip ${blockClassChip(block.classification)}`}
                    >
                      {blockClassLabel(block.classification)}
                    </span>
                    {loc && <span className='tf-source-loc'>{loc}</span>}
                    {sourceUrl && (
                      <a
                        href={sourceUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='tf-source-link'
                      >
                        source ↗
                      </a>
                    )}
                  </figcaption>
                </figure>
              )
            })}
            {missingIds.length > 0 && (
              <p className='notice notice-error'>
                {missingIds.length} referenced block
                {missingIds.length > 1 ? 's' : ''} could not be resolved against
                this source version.
              </p>
            )}
          </section>
        )}
      </aside>
    </>
  )
}
