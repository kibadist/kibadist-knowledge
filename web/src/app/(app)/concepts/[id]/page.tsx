'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

/**
 * Concept view — a single unit of understanding and everything attached to it:
 * the user's articulations, its connections to other concepts, and its
 * retrieval history. Shell only; sections get wired to the API in a later
 * ticket. Auth-gated by the (app) group layout.
 */
export default function ConceptViewPage() {
  const params = useParams<{ id: string }>()

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Link
          href='/concepts'
          className='text-sm text-neutral-400 hover:text-white'
        >
          ← Concepts
        </Link>
        <h1 className='mt-2 text-2xl font-semibold'>Concept</h1>
        <p className='font-mono text-sm text-neutral-500'>{params.id}</p>
      </div>

      <Section
        title='Articulations'
        hint='Your explanations, in your own words.'
      />
      <Section title='Connections' hint='How this idea relates to others.' />
      <Section title='Retrieval' hint='When you’ve been quizzed on this.' />
    </div>
  )
}

function Section({ title, hint }: { title: string; hint: string }) {
  return (
    <section className='rounded-lg border border-neutral-800 p-4'>
      <h2 className='font-medium'>{title}</h2>
      <p className='mt-1 text-sm text-neutral-500'>{hint}</p>
    </section>
  )
}
