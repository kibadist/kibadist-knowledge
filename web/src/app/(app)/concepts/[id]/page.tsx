'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import {
  api,
  type ConceptArticulation,
  type ConceptLinkEnd,
  type ConceptRetrievalEvent,
} from '@/lib/api'

/**
 * Concept view — a single unit of earned understanding and its proof-of-learning
 * artifacts: the user's own-words articulations, its connections to other
 * concepts, and the retrieval history that proves it was recalled from memory.
 */
export default function ConceptViewPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const conceptQuery = useQuery({
    queryKey: ['concept', id],
    queryFn: () => api.getConcept(id),
  })

  const concept = conceptQuery.data

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Link
          href='/concepts'
          className='text-sm text-neutral-400 hover:text-white'
        >
          ← Concepts
        </Link>
        <h1 className='mt-2 text-2xl font-semibold'>
          {concept?.title ?? 'Concept'}
        </h1>
        {concept && (
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
              {concept.status}
            </span>
            {concept.cognitiveState && (
              <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                {concept.cognitiveState}
              </span>
            )}
            {concept.gateMode && (
              <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                {concept.gateMode}
              </span>
            )}
          </div>
        )}
      </div>

      {conceptQuery.isLoading && (
        <p className='text-neutral-400'>Loading concept…</p>
      )}
      {conceptQuery.isError && (
        <p className='text-red-400'>Could not load this concept.</p>
      )}

      {concept && (
        <>
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>Articulations</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Your explanations, in your own words.
              </p>
            </div>
            {concept.articulations.length === 0 ? (
              <p className='text-sm text-neutral-500'>
                No articulations recorded.
              </p>
            ) : (
              <ol className='flex flex-col gap-3'>
                {concept.articulations.map((a, i) => (
                  <ArticulationItem
                    key={a.id}
                    articulation={a}
                    canonical={i === 0}
                  />
                ))}
              </ol>
            )}
          </section>

          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>Connections</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                How this idea relates to others.
              </p>
            </div>
            {concept.outgoingLinks.length === 0 &&
            concept.incomingLinks.length === 0 ? (
              <p className='text-sm text-neutral-500'>No connections yet.</p>
            ) : (
              <ul className='flex flex-col gap-2'>
                {concept.outgoingLinks.map((link) => (
                  <LinkItem
                    key={link.id}
                    link={link}
                    other={link.targetConcept}
                    direction='→'
                  />
                ))}
                {concept.incomingLinks.map((link) => (
                  <LinkItem
                    key={link.id}
                    link={link}
                    other={link.sourceConcept}
                    direction='←'
                  />
                ))}
              </ul>
            )}
          </section>

          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>Retrieval</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Proof you recalled this from memory.
              </p>
            </div>
            {concept.retrievalEvents.length === 0 ? (
              <p className='text-sm text-neutral-500'>
                No retrieval events yet.
              </p>
            ) : (
              <ol className='flex flex-col gap-3'>
                {concept.retrievalEvents.map((event, i) => (
                  <RetrievalItem key={event.id} event={event} first={i === 0} />
                ))}
              </ol>
            )}
          </section>

          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>Provenance</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Where this came from.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2 text-sm text-neutral-400'>
              {concept.captureSource && (
                <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                  {concept.captureSource}
                </span>
              )}
              {concept.sourceUrl && (
                <a
                  href={concept.sourceUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='truncate text-amber-400/80 hover:underline'
                >
                  {concept.sourceUrl}
                </a>
              )}
            </div>
            {concept.sourceText && (
              <div className='max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-400'>
                {concept.sourceText}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function ArticulationItem({
  articulation,
  canonical,
}: {
  articulation: ConceptArticulation
  canonical: boolean
}) {
  return (
    <li className='rounded-md border border-neutral-800 bg-neutral-950/50 p-3'>
      <div className='mb-1 flex items-center gap-2'>
        {canonical && (
          <span className='rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-300'>
            Canonical
          </span>
        )}
        <time className='text-xs text-neutral-600'>
          {new Date(articulation.createdAt).toLocaleString()}
        </time>
      </div>
      <p className='whitespace-pre-wrap text-sm text-neutral-100'>
        {articulation.body}
      </p>
    </li>
  )
}

function LinkItem({
  link,
  other,
  direction,
}: {
  link: ConceptLinkEnd
  other?: { id: string; title: string }
  direction: string
}) {
  return (
    <li className='flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/50 p-3 text-sm'>
      <span className='text-neutral-500'>{direction}</span>
      {other ? (
        <Link
          href={`/concepts/${other.id}`}
          className='font-medium text-neutral-100 hover:underline'
        >
          {other.title}
        </Link>
      ) : (
        <span className='text-neutral-500'>Unknown concept</span>
      )}
      {link.relation && (
        <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
          {link.relation}
        </span>
      )}
      <span className='ml-auto rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
        {link.status}
      </span>
    </li>
  )
}

function RetrievalItem({
  event,
  first,
}: {
  event: ConceptRetrievalEvent
  first: boolean
}) {
  return (
    <li className='rounded-md border border-neutral-800 bg-neutral-950/50 p-3'>
      <div className='mb-2 flex items-center gap-2'>
        {first && (
          <span className='rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-300'>
            First retrieval
          </span>
        )}
        {event.score !== null && (
          <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
            Score {event.score}/5
          </span>
        )}
        <time className='ml-auto text-xs text-neutral-600'>
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
      {event.question && (
        <p className='text-sm font-medium text-neutral-100'>{event.question}</p>
      )}
      {event.response && (
        <p className='mt-1 whitespace-pre-wrap text-sm text-neutral-400'>
          {event.response}
        </p>
      )}
    </li>
  )
}
