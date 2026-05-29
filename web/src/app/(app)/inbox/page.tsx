'use client'

import { RichTextEditor } from '@/components/editor'

/**
 * Inbox — the low-friction capture surface (step 1 of the core loop). Capture
 * does not create a permanent note; knowledge is earned later via articulation.
 * Shell only: the Lexical editor is the intended input surface, but wiring
 * capture to the API lands in a later ticket.
 */
export default function InboxPage() {
  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Inbox</h1>
        <p className='text-sm text-neutral-400'>
          Capture quickly. Nothing here is permanent yet — you’ll articulate it
          into a concept later.
        </p>
      </div>

      <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
        <RichTextEditor placeholder='Capture a thought, quote, or question…' />
        <button
          type='button'
          disabled
          title='Capture wiring lands in a later ticket'
          className='self-start rounded-md bg-white px-4 py-2 font-medium text-black opacity-50'
        >
          Capture
        </button>
      </section>

      <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
        <p className='text-neutral-400'>Your inbox is empty.</p>
        <p className='mt-1 text-sm text-neutral-500'>
          Captured items will appear here, waiting to be compressed into
          concepts.
        </p>
      </section>
    </div>
  )
}
