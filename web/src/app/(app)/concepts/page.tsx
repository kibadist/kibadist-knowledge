'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { api, type Concept } from '@/lib/api'
// Humanized labels (DET-304): one source of truth for every enum label.
import {
  CERTAINTY_LABELS,
  COGNITIVE_STATE_LABELS,
  GATE_MODE_LABELS,
} from '@/lib/labels'

/** A concept counts as "active" while it's above the fade floor and not dormant. */
function isActive(c: Concept): boolean {
  return c.cognitiveState !== 'DORMANT' && c.currentActivation >= 0.5
}

/**
 * Concepts — the permanent layer of earned understanding. Everything here was
 * earned through the gates: articulated in the user's own words, connected to
 * other ideas, and recalled from memory. Captured ≠ knowledge.
 *
 * The list leads with the signals that matter for earned knowledge (DET-241):
 * how well-understood (cognitive state), how sure (certainty), and how alive in
 * memory (decay) — grouped Active vs Faded so what's slipping is visible.
 */
export default function ConceptsPage() {
  const conceptsQuery = useQuery({
    queryKey: ['concepts'],
    queryFn: api.listConcepts,
  })

  const concepts = conceptsQuery.data ?? []
  const active = concepts.filter(isActive)
  const faded = concepts.filter((c) => !isActive(c))

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Knowledge · Earned</div>
        <h1>Concepts</h1>
        {concepts.length > 0 && (
          <div className='head-count earned'>{concepts.length} earned</div>
        )}
        <p className='lede'>
          Ideas you’ve articulated in your own words and connected to others.
          Captured ≠ knowledge — everything here passed the gate.
        </p>
      </div>

      {conceptsQuery.isLoading && <p className='notice'>Loading concepts…</p>}
      {conceptsQuery.isError && (
        <p className='notice notice-error'>Could not load your concepts.</p>
      )}

      {!conceptsQuery.isLoading && concepts.length === 0 && (
        <div className='empty'>
          No concepts yet.
          <span>
            Compress something from your inbox to create your first concept.
          </span>
        </div>
      )}

      {concepts.length > 0 && (
        <div className='queue'>
          {active.length > 0 && (
            <section className='queue-group'>
              <h2 className='group-head'>
                Active <span>{active.length}</span>
              </h2>
              <ul className='rows'>
                {active.map((c) => (
                  <ConceptRow key={c.id} concept={c} />
                ))}
              </ul>
            </section>
          )}

          {faded.length > 0 && (
            <section className='queue-group'>
              <h2 className='group-head'>
                Faded <span>{faded.length}</span>
              </h2>
              <ul className='rows'>
                {faded.map((c) => (
                  <ConceptRow key={c.id} concept={c} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function ConceptRow({ concept }: { concept: Concept }) {
  // Memory decay (DET-195): a faded concept (current activation below 0.5) is
  // dimmed; a DORMANT one has decayed past the floor and is hidden from active
  // retrieval. Contested (DET-199): conflicts with something the user holds and
  // must stay visibly marked here, just as on the detail and in the session.
  const dormant = concept.cognitiveState === 'DORMANT'
  const contested = concept.cognitiveState === 'CONTESTED'
  const faded = dormant || concept.currentActivation < 0.5
  const tone = contested ? 'contested' : dormant ? 'dormant' : 'earned'

  return (
    <li className={`concept-row${faded ? ' faded' : ''}`}>
      <div className='concept-meta'>
        <span className={`cstate cstate-${tone}`}>
          <span className='cstate-dot' />
          {COGNITIVE_STATE_LABELS[concept.cognitiveState]}
        </span>
        <span className={`ccert ccert-${concept.certainty.toLowerCase()}`}>
          {CERTAINTY_LABELS[concept.certainty]}
        </span>
        {concept.gateMode && (
          <span className='cgate'>{GATE_MODE_LABELS[concept.gateMode]}</span>
        )}
      </div>

      <Link href={`/concepts/${concept.id}`} className='row-title'>
        {concept.title}
      </Link>

      <p className='row-excerpt'>{concept.summary || '—'}</p>
    </li>
  )
}
