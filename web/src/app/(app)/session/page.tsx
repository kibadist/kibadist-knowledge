'use client'

/**
 * Session — spaced resurfacing as questions, not reminders (steps 4–5 of the
 * core loop). Shell only; the scheduler and question flow land in later tickets.
 */
export default function SessionPage() {
  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Session</h1>
        <p className='text-sm text-neutral-400'>
          The system resurfaces concepts as questions, so you rebuild
          understanding instead of rereading.
        </p>
      </div>

      <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
        <p className='text-neutral-400'>Nothing is due for review.</p>
        <p className='mt-1 text-sm text-neutral-500'>
          Concepts you articulate will resurface here when it’s time to recall
          them.
        </p>
      </section>
    </div>
  )
}
