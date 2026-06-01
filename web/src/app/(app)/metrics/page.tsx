'use client'

import { useQuery } from '@tanstack/react-query'

import { api, type UnderstandingMetrics } from '@/lib/api'

/**
 * Understanding (DET-200) — the Anti-Vanity Metrics surface. Every number here
 * goes up only when you actually understand MORE: how well you retain what
 * you've earned, the synthesis you've built, and what moved forward recently.
 *
 * Deliberately absent: streaks, notes captured, "AI summaries generated", or any
 * count that rewards volume. The product's thesis is that hoarding is the
 * problem — so we don't keep score by how much you've piled up.
 */
export default function MetricsPage() {
  const metricsQuery = useQuery({
    queryKey: ['metrics'],
    queryFn: api.getMetrics,
  })

  const metrics = metricsQuery.data

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Understanding · Anti-vanity</div>
        <h1>Understanding</h1>
        <p className='lede'>
          These numbers move only when you understand more — not when you pile
          up more.
        </p>
      </div>

      {metricsQuery.isLoading && <p className='notice'>Loading…</p>}
      {metricsQuery.isError && (
        <p className='notice notice-error'>Could not load your metrics.</p>
      )}

      {metrics && <MetricsBody metrics={metrics} />}
    </div>
  )
}

function MetricsBody({ metrics }: { metrics: UnderstandingMetrics }) {
  const ratePct =
    metrics.retrievalSuccessRate === null
      ? null
      : Math.round(metrics.retrievalSuccessRate * 100)

  // The server provides the one-line "why this is a real signal" per metric;
  // look each up by key so the explanation stays a single source of truth.
  const why = (key: string): string =>
    metrics.explanations.find((e) => e.key === key)?.explanation ?? ''

  const sharperPct =
    metrics.compressionQualityTrend.sharperShare === null
      ? null
      : Math.round(metrics.compressionQualityTrend.sharperShare * 100)
  const advancedPct =
    metrics.advancedShare === null
      ? null
      : Math.round(metrics.advancedShare * 100)

  return (
    <>
      <section className='metric-group'>
        <h2 className='metric-head'>Retention</h2>
        <div className='metric-grid'>
          <MetricCard
            label='Retrieval success'
            value={ratePct === null ? '—' : `${ratePct}%`}
            hint={
              ratePct === null
                ? 'Recall something in a session and this starts tracking.'
                : `${metrics.retrievalsPassed} of ${metrics.retrievalsTotal} recalls held up.`
            }
            why={why('retrievalSuccessRate')}
          />
          <MetricCard
            label='Concepts retained'
            value={metrics.conceptsRetained}
            hint='Ideas that have survived recall, not just been filed away.'
          />
        </div>
      </section>

      <section className='metric-group'>
        <h2 className='metric-head'>Synthesis</h2>
        <div className='metric-grid'>
          <MetricCard
            label='Concepts internalized'
            value={metrics.conceptsInternalized}
            hint='Understanding that has become yours.'
          />
          <MetricCard
            label='Concepts defended'
            value={metrics.conceptsDefended}
            hint='Held up under a Tutor challenge.'
          />
          <MetricCard
            label='Synthesis events'
            value={metrics.connectionsValidated}
            hint='Edges you confirmed between ideas — synthesis, not storage.'
            why={why('connectionsValidated')}
          />
          <MetricCard
            label='Reflections logged'
            value={metrics.reflectionsLogged}
            hint='Times you noticed what moved in your understanding.'
          />
        </div>
      </section>

      <section className='metric-group'>
        <h2 className='metric-head'>Depth &amp; transfer</h2>
        <div className='metric-grid'>
          <MetricCard
            label='Compression quality'
            value={sharperPct === null ? '—' : `${sharperPct}%`}
            hint={
              metrics.compressionQualityTrend.revisitedConcepts === 0
                ? 'Re-explain a concept a second time and this starts tracking.'
                : `${metrics.compressionQualityTrend.revisitedConcepts} concepts re-articulated; this share got shorter.`
            }
            why={why('compressionQualityTrend')}
          />
          <MetricCard
            label='Transfer signals'
            value={metrics.transferSignals}
            hint='Older ideas you reached back to while building newer ones.'
            why={why('transferSignals')}
          />
          <MetricCard
            label='Defended / internalized share'
            value={advancedPct === null ? '—' : `${advancedPct}%`}
            hint={
              advancedPct === null
                ? 'Earn a concept past the inbox and this starts tracking.'
                : 'Of your live concepts, the share you’ve defended or internalized.'
            }
            why={why('advancedShare')}
          />
          <MetricCard
            label='Decay recovery'
            value={metrics.decayRecovery}
            hint='Dormant concepts you brought back to life.'
            why={why('decayRecovery')}
          />
        </div>
      </section>

      <section className='metric-group'>
        <h2 className='metric-head'>Movement</h2>
        <MetricCard
          label='Understanding moved (30d)'
          value={metrics.forwardTransitions30d}
          hint='Concepts that climbed the mastery ladder in the last month. A quiet month is fine — depth isn’t a streak.'
          why={why('forwardTransitions30d')}
        />
      </section>

      <section className='metric-group'>
        <h2 className='metric-head'>Retrieval over time</h2>
        <RetrievalTrend points={metrics.retrievalTrend} />
      </section>

      <div className='anti-vanity'>
        We don’t track streaks, how many notes you’ve captured, words written,
        how many AI summaries got generated, inbox throughput, or time spent in
        the app. Hoarding isn’t learning — so it isn’t a score here.
      </div>
    </>
  )
}

// A tiny inline weekly bar list (no chart lib): one row per week, the bar width
// is the pass rate. Weeks with no graded recalls render as a muted "no data".
function RetrievalTrend({
  points,
}: {
  points: UnderstandingMetrics['retrievalTrend']
}) {
  const hasAny = points.some((p) => p.rate !== null)

  return (
    <div className='panel trend'>
      {!hasAny ? (
        <p className='block-sub'>
          Recall concepts over a few weeks and your trend appears here.
        </p>
      ) : (
        points.map((p) => {
          const pct = p.rate === null ? null : Math.round(p.rate * 100)
          const label = new Date(p.weekStart).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })
          return (
            <div key={p.weekStart} className='trend-row'>
              <span className='trend-w'>{label}</span>
              <div className='trend-bar'>
                <div className='trend-fill' style={{ width: `${pct ?? 0}%` }} />
              </div>
              <span className='trend-pct'>
                {pct === null ? '—' : `${pct}%`}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  why,
}: {
  label: string
  value: number | string
  hint: string
  // The server-provided "why this is a real signal of understanding" line.
  why?: string
}) {
  return (
    <div className='metric'>
      <div className='label'>{label}</div>
      <div className='metric-num'>{value}</div>
      <div className='metric-hint'>{hint}</div>
      {why ? <div className='metric-why'>{why}</div> : null}
    </div>
  )
}
