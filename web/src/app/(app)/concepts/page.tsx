'use client'

/**
 * Concepts — the permanent layer of earned understanding. Shell only; the list
 * gets wired to the concepts API in a later ticket.
 */
export default function ConceptsPage() {
  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Concepts</h1>
        <p className='text-sm text-neutral-400'>
          Ideas you’ve articulated in your own words and connected to others.
        </p>
      </div>

      <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
        <p className='text-neutral-400'>No concepts yet.</p>
        <p className='mt-1 text-sm text-neutral-500'>
          Compress something from your inbox to create your first concept.
        </p>
      </section>
    </div>
  )
}
