'use client'

import { useMemo, useState } from 'react'
import type {
  BlockContext,
  LearningModeHandlers,
  ReadingMode,
  SectionContext,
} from '@/components/deep-reading'
import { DeepReadingMode } from '@/components/deep-reading'
import { SAMPLE_ARTICLE } from '@/components/deep-reading/sample-article'
import { useArticleLearningState } from '@/lib/article-learning-events'

/**
 * Deep Reading Mode demo / story states (DET-284). The web package has no test
 * runner, so — mirroring /reader/demo — this non-nav developer page exercises
 * the reading surface against a representative Article JSON v2 fixture and the
 * full learning loop. Visit /deep-reading/demo while signed in.
 *
 * The handlers below stand in for the downstream exercise modes: each emits the
 * completion event the real mode would, through a shared learning store, so the
 * reading surface lights up its completion markers. This demonstrates the
 * `article_learning_events` contract end to end without a backend.
 */
export default function DeepReadingDemoPage() {
  const [mode, setMode] = useState<ReadingMode>('deep')
  const [log, setLog] = useState<string[]>([])
  const [highlight, setHighlight] = useState(true)

  // A shared store so the demo handlers can emit completion events that the
  // reading surface reflects.
  const learning = useArticleLearningState({
    onEmit: (e) =>
      setLog((prev) =>
        [`${e.event_type} · ${e.section_id ?? '—'}`, ...prev].slice(0, 8),
      ),
  })

  const handlers = useMemo<LearningModeHandlers>(() => {
    const emitFor = (
      ctx: SectionContext,
      event_type: Parameters<typeof learning.emit>[0]['event_type'],
      block_id?: string,
    ) =>
      learning.emit({
        article_id: ctx.article.article_id,
        article_version_id: ctx.article.article_version_id,
        section_id: ctx.section.section_id,
        block_id,
        event_type,
        metadata: { surface: 'demo' },
      })

    return {
      onPredict: (ctx) => emitFor(ctx, 'prediction_submitted'),
      onRewrite: (ctx: BlockContext) =>
        emitFor(ctx, 'block_rewrite_submitted', ctx.block.block_id),
      onExtractConcepts: (ctx) => emitFor(ctx, 'concept_candidate_approved'),
      onCompare: (ctx: BlockContext) =>
        emitFor(ctx, 'comparison_generated', ctx.block.block_id),
      onReview: (ctx) => emitFor(ctx, 'review_completed'),
    }
  }, [learning])

  return (
    <div className='screen'>
      <p className='section-label'>§ Deep Reading · Demo</p>
      <h1>Deep Reading Mode — demo</h1>
      <p className='lede'>
        The polished generated-article reading surface (DET-284) with quiet
        entry points into active learning. Hover a section to reveal its
        actions; click one and watch its completion marker appear.
      </p>

      <div className='seg-row'>
        <button
          type='button'
          onClick={() => setMode('deep')}
          className={`seg${mode === 'deep' ? ' on' : ''}`}
        >
          Open in deep
        </button>
        <button
          type='button'
          onClick={() => setMode('overview')}
          className={`seg${mode === 'overview' ? ' on' : ''}`}
        >
          Open in overview
        </button>
        <button
          type='button'
          onClick={() => setHighlight((h) => !h)}
          className={`seg${highlight ? ' on' : ''}`}
        >
          Key-term highlight
        </button>
      </div>

      <DeepReadingMode
        key={mode}
        article={SAMPLE_ARTICLE}
        initialMode={mode}
        learningState={learning}
        handlers={handlers}
        highlightKeyTerms={highlight}
        provenance={{
          captureSource: 'URL',
          sourceUrl: 'https://example.com/articles/spaced-repetition',
          sourceAvailable: true,
        }}
      />

      {log.length > 0 && (
        <div className='panel'>
          <p className='panel-h'>article_learning_events (latest)</p>
          <ul
            className='u-mono'
            style={{ marginTop: '0.75rem', lineHeight: 1.8 }}
          >
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
