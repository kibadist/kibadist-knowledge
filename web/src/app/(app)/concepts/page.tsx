'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { api, type Concept } from '@/lib/api'

/**
 * Concepts — the permanent layer of earned understanding. Everything here was
 * earned through the four gates: articulated in the user's own words, connected
 * to other ideas, and recalled from memory. Captured ≠ knowledge.
 */
export default function ConceptsPage() {
  const conceptsQuery = useQuery({
    queryKey: ['concepts'],
    queryFn: api.listConcepts,
  })

  const concepts = conceptsQuery.data ?? []

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Knowledge · Earned</div>
        <h1>Concepts</h1>
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
        <ul className='rows'>
          {concepts.map((concept) => (
            <ConceptRow key={concept.id} concept={concept} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ConceptRow({ concept }: { concept: Concept }) {
  // Memory decay (DET-195): a faded concept (current activation below 0.5) is
  // dimmed; a DORMANT one has decayed past the floor and is hidden from active
  // retrieval — call it out so the user can choose to revive it.
  const dormant = concept.cognitiveState === 'DORMANT'
  const faded = dormant || concept.currentActivation < 0.5
  // Contested (DET-199): a concept flagged as conflicting with something the
  // user holds. It must be visibly marked here in the list, just as it is on the
  // concept detail and in the session view — never hidden behind the plain state
  // chip.
  const contested = concept.cognitiveState === 'CONTESTED'

  return (
    <li className={`concept-row${faded ? ' faded' : ''}`}>
      <div className='row-top'>
        {concept.cognitiveState && (
          <span className='chip chip-quiet'>{concept.cognitiveState}</span>
        )}
        {dormant && <span className='chip chip-pending'>Dormant</span>}
        {contested && <span className='chip chip-contested'>Contested</span>}
        {concept.gateMode && (
          <span className='chip chip-quiet'>{concept.gateMode}</span>
        )}
      </div>

      <Link href={`/concepts/${concept.id}`} className='row-title'>
        {concept.title}
      </Link>

      <p className='row-excerpt'>{concept.summary || '—'}</p>
    </li>
  )
}
