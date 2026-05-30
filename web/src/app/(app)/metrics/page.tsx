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
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Understanding</h1>
        <p className='text-sm text-neutral-400'>
          These numbers move only when you understand more — not when you pile
          up more.
        </p>
      </div>

      {metricsQuery.isLoading && <p className='text-neutral-400'>Loading…</p>}
      {metricsQuery.isError && (
        <p className='text-red-400'>Could not load your metrics.</p>
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

  return (
    <div className='flex flex-col gap-6'>
      <section className='flex flex-col gap-3'>
        <h2 className='text-xs font-medium uppercase tracking-wide text-neutral-500'>
          Retention
        </h2>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <MetricCard
            label='Retrieval success'
            value={ratePct === null ? '—' : `${ratePct}%`}
            hint={
              ratePct === null
                ? 'Recall something in a session and this starts tracking.'
                : `${metrics.retrievalsPassed} of ${metrics.retrievalsTotal} recalls held up.`
            }
          />
          <MetricCard
            label='Concepts retained'
            value={metrics.conceptsRetained}
            hint='Ideas that have survived recall, not just been filed away.'
          />
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-xs font-medium uppercase tracking-wide text-neutral-500'>
          Synthesis
        </h2>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
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
            label='Connections you’ve drawn'
            value={metrics.connectionsValidated}
            hint='Edges you confirmed between ideas — synthesis, not storage.'
          />
          <MetricCard
            label='Reflections logged'
            value={metrics.reflectionsLogged}
            hint='Times you noticed what moved in your understanding.'
          />
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-xs font-medium uppercase tracking-wide text-neutral-500'>
          Movement
        </h2>
        <MetricCard
          label='Understanding moved (30d)'
          value={metrics.forwardTransitions30d}
          hint='Concepts that climbed the mastery ladder in the last month. A quiet month is fine — depth isn’t a streak.'
        />
      </section>

      <section className='rounded-lg border border-dashed border-neutral-800 p-4'>
        <p className='text-sm text-neutral-400'>
          We don’t track streaks, how many notes you’ve captured, or how many AI
          summaries got generated. Hoarding isn’t learning — so it isn’t a score
          here.
        </p>
      </section>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint: string
}) {
  return (
    <div className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
      <p className='text-sm text-neutral-400'>{label}</p>
      <p className='mt-1 text-3xl font-semibold text-neutral-100'>{value}</p>
      <p className='mt-1 text-xs text-neutral-500'>{hint}</p>
    </div>
  )
}
