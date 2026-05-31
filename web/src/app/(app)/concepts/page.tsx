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
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Concepts</h1>
        <p className='text-sm text-neutral-400'>
          Ideas you’ve articulated in your own words and connected to others.
        </p>
      </div>

      {conceptsQuery.isLoading && (
        <p className='text-neutral-400'>Loading concepts…</p>
      )}
      {conceptsQuery.isError && (
        <p className='text-red-400'>Could not load your concepts.</p>
      )}

      {!conceptsQuery.isLoading && concepts.length === 0 && (
        <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
          <p className='text-neutral-400'>No concepts yet.</p>
          <p className='mt-1 text-sm text-neutral-500'>
            Compress something from your inbox to create your first concept.
          </p>
        </section>
      )}

      {concepts.length > 0 && (
        <ul className='flex flex-col gap-3'>
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
    <li
      className={`rounded-lg border border-neutral-800 bg-neutral-900 p-4 ${
        faded ? 'opacity-50' : ''
      }`}
    >
      <div className='flex items-center gap-2'>
        {concept.cognitiveState && (
          <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
            {concept.cognitiveState}
          </span>
        )}
        {dormant && (
          <span className='rounded border border-amber-700/60 bg-amber-950/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300'>
            Dormant
          </span>
        )}
        {contested && (
          <span className='rounded border border-red-600/70 bg-red-950/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300'>
            Contested
          </span>
        )}
        {concept.gateMode && (
          <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
            {concept.gateMode}
          </span>
        )}
      </div>

      <Link
        href={`/concepts/${concept.id}`}
        className='mt-2 block font-medium text-neutral-100 hover:underline'
      >
        {concept.title}
      </Link>

      <p className='mt-1 line-clamp-3 text-sm text-neutral-400'>
        {concept.summary || '—'}
      </p>
    </li>
  )
}
