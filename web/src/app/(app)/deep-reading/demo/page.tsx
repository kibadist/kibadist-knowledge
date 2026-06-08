'use client'

import { type CSSProperties, useMemo, useState } from 'react'
import type {
  LearningModeHandlers,
  ReadingMode,
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
// Dev harness controls grouped by the three stages (DET-314).
const STAGE_HARNESS: {
  stage: string
  modes: { mode: ReadingMode; label: string }[]
}[] = [
  {
    stage: 'Read',
    modes: [
      { mode: 'overview', label: 'overview' },
      { mode: 'deep', label: 'deep' },
    ],
  },
  {
    stage: 'Recall',
    modes: [
      { mode: 'predict', label: 'predict' },
      { mode: 'rewrite', label: 'rewrite' },
      { mode: 'compare', label: 'compare' },
    ],
  },
  {
    stage: 'Keep',
    modes: [
      { mode: 'extract', label: 'extract' },
      { mode: 'review', label: 'review' },
    ],
  },
]

const DEMO_STAGE_CAPTION: CSSProperties = {
  alignSelf: 'center',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-faint)',
  minWidth: '3.5rem',
}

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

  // onPredict / onRewrite / onCompare / onExtractConcepts / onReview are
  // intentionally omitted so the section actions and tabs open the built-in
  // modes: Predict Before Reveal (DET-282), Rewrite-the-Block (DET-285),
  // Compare & Repair (DET-286), Concept Extraction (DET-287), and Spaced Review
  // (DET-288). They emit prediction_submitted / block_rewrite_started /
  // rewrite_peeked / block_rewrite_submitted / section_revealed /
  // comparison_generated / rewrite_revised / concept_candidate_approved /
  // review_prompt_approved through this same store.
  const handlers = useMemo<LearningModeHandlers>(() => ({}), [])

  return (
    <div className='screen'>
      <p className='section-label'>§ Deep Reading · Demo</p>
      <h1>Deep Reading Mode — demo</h1>
      <p className='lede'>
        The polished generated-article reading surface (DET-284), now grouped
        into the three-stage learning arc —{' '}
        <strong>Read → Recall → Keep</strong> (DET-314) — with a progress rail
        that lights each stage as its representative events land. Hover a
        section to reveal its actions; click one and watch its completion marker
        appear. Switch to <strong>Overview</strong> for the DET-280 key-term
        skeleton: headings and key terms stay crisp while the prose is blurred —
        click a term to preview where it occurs, then start guided reading.
        Switch to <strong>Predict</strong> for the DET-282 predict-before-reveal
        flow: answer from the heading and key terms, then reveal the section and
        see how your model compares. Switch to <strong>Rewrite</strong> for the
        DET-285 active-recall flow: reconstruct each block from memory while the
        source blurs the moment you start writing — peek if you must, it&apos;s
        tracked. Then switch to <strong>Compare</strong> for the DET-286
        compare-and-repair flow: each rewrite you submitted is checked against
        the article block — see what you preserved, missed, or changed, then
        make one improved attempt. Finally switch to{' '}
        <strong>Extract concepts</strong> for the DET-287 flow: the
        article&apos;s key terms and seeded concepts become candidates you can
        approve, edit, or reject — a concept is only validated once you explain
        it yourself. Finally switch to <strong>Spaced review</strong> for the
        DET-288 flow: your rewrites, comparisons, and saved concepts become
        review prompts — grouped by recall, misconception repair, contrast, and
        transfer — that you approve before they enter your Retrieval Engine.
      </p>

      {/* Harness grouped by the three stages (DET-314) so the dev controls
          mirror the staged surface they drive. */}
      {STAGE_HARNESS.map((group) => (
        <div key={group.stage} className='seg-row'>
          <span className='u-mono' style={DEMO_STAGE_CAPTION}>
            {group.stage}
          </span>
          {group.modes.map((m) => (
            <button
              key={m.mode}
              type='button'
              onClick={() => setMode(m.mode)}
              className={`seg${mode === m.mode ? ' on' : ''}`}
            >
              Open in {m.label}
            </button>
          ))}
        </div>
      ))}
      <div className='seg-row'>
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
        onSaveConcept={(c) =>
          setLog((prev) =>
            [`concept saved · ${c.name} (${c.status})`, ...prev].slice(0, 8),
          )
        }
        onSchedulePrompt={(p) =>
          setLog((prev) =>
            [
              `prompt scheduled · ${p.prompt_type} · ${p.subject}`,
              ...prev,
            ].slice(0, 8),
          )
        }
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
