'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { ArticleReader } from '@/components/reader/article-reader'
import {
  api,
  type Certainty,
  type ConceptArticulation,
  type ConceptLinkEnd,
  type ConceptRetrievalEvent,
  type LinkRelation,
  type Reflection,
  type ReflectionKind,
  type StateTransition,
} from '@/lib/api'

// DET-191: typed relationship labels + distinct styling for contradiction /
// redundancy so a conflicting or duplicative edge stands out in the graph view.
const RELATION_LABELS: Record<LinkRelation, string> = {
  ANALOGY: 'analogy',
  CONTRADICTION: 'contradiction',
  SUPPORTS: 'supports',
  DEPENDS_ON: 'depends on',
  REFINES: 'refines',
  REDUNDANT: 'redundant',
}

// DET-196: human labels for the reflection kinds shown in "What changed".
const REFLECTION_LABELS: Record<ReflectionKind, string> = {
  CLEARER: 'got clearer',
  LESS_CLEAR: 'less clear',
  CONNECTED: 'connected',
  CHALLENGE_NEXT: 'to challenge',
}

// DET-199: the user's epistemic stance, in their own framing. Order is the
// control's left-to-right options.
const CERTAINTY_OPTIONS: { value: Certainty; label: string }[] = [
  { value: 'ASSERTED', label: 'Asserted' },
  { value: 'TENTATIVE', label: 'Tentative' },
  { value: 'UNCERTAIN', label: 'Unsure' },
]

function certaintyChipClass(certainty: Certainty): string {
  if (certainty === 'UNCERTAIN')
    return 'border-amber-700/60 bg-amber-950/30 text-amber-300'
  if (certainty === 'TENTATIVE')
    return 'border-sky-700/60 bg-sky-950/30 text-sky-300'
  return 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300'
}

function relationChipClass(kind: LinkRelation): string {
  if (kind === 'CONTRADICTION')
    return 'border-red-700/60 bg-red-950/30 text-red-300'
  if (kind === 'REDUNDANT')
    return 'border-amber-700/60 bg-amber-950/30 text-amber-300'
  return 'border-neutral-700 text-neutral-500'
}

/**
 * Concept view — a single unit of earned understanding and its proof-of-learning
 * artifacts: the user's own-words articulations, its connections to other
 * concepts, and the retrieval history that proves it was recalled from memory.
 */
export default function ConceptViewPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const queryClient = useQueryClient()
  const conceptQuery = useQuery({
    queryKey: ['concept', id],
    queryFn: () => api.getConcept(id),
  })

  // Memory decay (DET-195): bring a faded/dormant concept back to full
  // prominence. Refresh this view + the list so the new state shows immediately.
  const reviveMutation = useMutation({
    mutationFn: () => api.reviveConcept(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['concept', id] })
      void queryClient.invalidateQueries({ queryKey: ['concepts'] })
    },
  })

  // Provenance & Uncertainty (DET-199): let the user set how sure they are.
  // Refresh this view so the new stance shows immediately.
  const certaintyMutation = useMutation({
    mutationFn: (certainty: Certainty) => api.setCertainty(id, certainty),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['concept', id] })
      void queryClient.invalidateQueries({ queryKey: ['concepts'] })
    },
  })

  const concept = conceptQuery.data
  const dormant = concept?.cognitiveState === 'DORMANT'
  // Contested (DET-199): a concept the user has flagged as conflicting with
  // something they hold. It must be unmistakable here, as it is in the list and
  // the session view — never a quiet state chip.
  const contested = concept?.cognitiveState === 'CONTESTED'

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
            {/* Uncertainty (DET-199): the user's own stance, shown plainly so
                what they're unsure of is never flattened into implied certainty. */}
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${certaintyChipClass(
                concept.certainty,
              )}`}
            >
              {concept.certainty}
            </span>
            {/* Memory decay (DET-195): current activation, with a DORMANT
                call-out + a Revive control when it has faded past the floor. */}
            <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
              Activation {Math.round(concept.currentActivation * 100)}%
            </span>
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
            {dormant && (
              <button
                type='button'
                onClick={() => reviveMutation.mutate()}
                disabled={reviveMutation.isPending}
                className='rounded border border-amber-700/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300 hover:bg-amber-950/30 disabled:opacity-50'
              >
                {reviveMutation.isPending ? 'Reviving…' : 'Revive'}
              </button>
            )}
          </div>
        )}
        {reviveMutation.isError && (
          <p className='mt-2 text-xs text-red-400'>
            Could not revive this concept. Try again.
          </p>
        )}
        {concept && concept.stateHistory.length > 0 && (
          <ol className='mt-3 flex flex-col gap-1 text-xs text-neutral-500'>
            {concept.stateHistory.map((t) => (
              <StateHistoryItem key={t.id} transition={t} />
            ))}
          </ol>
        )}
      </div>

      {contested && (
        <div className='rounded-lg border border-red-600/70 bg-red-950/40 p-4'>
          <p className='text-sm font-semibold uppercase tracking-wide text-red-300'>
            Contested
          </p>
          <p className='mt-1 text-sm text-red-200/80'>
            This concept conflicts with something else you hold. It&apos;s
            flagged so the tension stays visible until you resolve it.
          </p>
        </div>
      )}

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
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='font-medium'>Articulations</h2>
                {/* Authorship (DET-199): the Articulations are user-authored —
                    the user's own compression + tutor responses. Tagged so it's
                    unmistakable this is what the user wrote, not AI or source. */}
                <AuthorTag author='USER' />
              </div>
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
            {(() => {
              // Only CONFIRMED links are real graph edges (DET-191). SUGGESTED
              // proposals and REJECTED dismissals are never rendered as edges.
              const outgoing = concept.outgoingLinks.filter(
                (l) => l.status === 'CONFIRMED',
              )
              const incoming = concept.incomingLinks.filter(
                (l) => l.status === 'CONFIRMED',
              )
              if (outgoing.length === 0 && incoming.length === 0) {
                return (
                  <p className='text-sm text-neutral-500'>
                    No connections yet.
                  </p>
                )
              }
              return (
                <ul className='flex flex-col gap-2'>
                  {outgoing.map((link) => (
                    <LinkItem
                      key={link.id}
                      link={link}
                      other={link.targetConcept}
                      direction='→'
                    />
                  ))}
                  {incoming.map((link) => (
                    <LinkItem
                      key={link.id}
                      link={link}
                      other={link.sourceConcept}
                      direction='←'
                    />
                  ))}
                </ul>
              )
            })()}
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
              <h2 className='font-medium'>What changed</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                How your understanding moved over time.
              </p>
            </div>
            {concept.reflections.length === 0 ? (
              <p className='text-sm text-neutral-500'>
                No reflections recorded yet.
              </p>
            ) : (
              <ol className='flex flex-col gap-2'>
                {concept.reflections.map((reflection) => (
                  <ReflectionItem key={reflection.id} reflection={reflection} />
                ))}
              </ol>
            )}
          </section>

          {/* Certainty control (DET-199): the user owns their epistemic stance.
              Framed so marking something unsure is legitimate, not a failure. */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>How sure are you?</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Your understanding has an honest edge. It&apos;s fine to mark
                what you&apos;re still unsure of — uncertainty is information,
                not a gap to hide.
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              {CERTAINTY_OPTIONS.map((option) => {
                const active = concept.certainty === option.value
                return (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => certaintyMutation.mutate(option.value)}
                    disabled={certaintyMutation.isPending}
                    className={`rounded border px-2.5 py-1 text-xs transition disabled:opacity-50 ${
                      active
                        ? certaintyChipClass(option.value)
                        : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {certaintyMutation.isError && (
              <p className='text-xs text-red-400'>
                Could not update certainty. Try again.
              </p>
            )}
            {/* Evidence density (DET-199): a second, objective uncertainty
                signal beyond the user's own stance — how many of their own
                compressions back this concept. A cheap, honest proxy; richer
                source-citation counting is a deferred refinement (server). */}
            <div className='flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3'>
              <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                Evidence {concept.evidenceDensity}
              </span>
              <p className='text-xs text-neutral-500'>
                {concept.evidenceDensity === 0
                  ? 'No articulations back this yet — thin support.'
                  : `Backed by ${concept.evidenceDensity} of your own ${
                      concept.evidenceDensity === 1
                        ? 'articulation'
                        : 'articulations'
                    } — more re-explanations mean better-supported.`}
              </p>
            </div>
          </section>

          {/* Provenance (DET-199): the source is where this came FROM, not the
              concept itself — the canonical text is the user's own compression. */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='font-medium'>Provenance</h2>
                {/* Authorship (DET-199): the source material is quoted, not
                    written by the user or the AI — tagged distinctly so it's
                    never mistaken for earned, user-authored knowledge. */}
                <AuthorTag author='SOURCE' />
              </div>
              <p className='mt-1 text-sm text-neutral-500'>
                The source below is where this came from — provenance, not the
                concept. The concept itself is your own articulation, compressed
                from this material in your words.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2 text-sm text-neutral-400'>
              {concept.captureSource && (
                <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                  {concept.captureSource}
                </span>
              )}
              {concept.sourceUrl ? (
                <a
                  href={concept.sourceUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='truncate text-amber-400/80 hover:underline'
                >
                  {concept.sourceUrl}
                </a>
              ) : (
                <span className='text-neutral-500'>
                  {concept.captureSource === 'PDF'
                    ? 'From a PDF you captured'
                    : concept.captureSource === 'PASTE'
                      ? 'Pasted text you captured'
                      : 'No external source recorded'}
                </span>
              )}
            </div>
            {concept.sourceText && (
              <ArticleReader
                document={concept.sourceDocument}
                content={concept.sourceText}
                variant='compact'
                showHeader={false}
                storageKey={`concept-${id}`}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

// Authorship classes (DET-199): every text region in a concept is one of three
// kinds, kept visually unmistakable so the user can always tell at a glance what
// they wrote vs. what the AI suggested vs. what was quoted from a source.
//  - USER   (emerald): user-authored — the compression + tutor responses.
//  - AI     (violet):  AI-assisted — e.g. Connector-proposed links.
//  - SOURCE (neutral): source-quoted — the original material, never knowledge.
type Author = 'USER' | 'AI' | 'SOURCE'

const AUTHOR_TAGS: Record<Author, { label: string; className: string }> = {
  USER: {
    label: 'You wrote this',
    className: 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300',
  },
  AI: {
    label: 'AI-assisted',
    className: 'border-violet-700/60 bg-violet-950/30 text-violet-300',
  },
  SOURCE: {
    label: 'Source — quoted',
    className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
  },
}

function AuthorTag({ author }: { author: Author }) {
  const { label, className } = AUTHOR_TAGS[author]
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {label}
    </span>
  )
}

function ReflectionItem({ reflection }: { reflection: Reflection }) {
  return (
    <li className='flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-950/50 p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
          {REFLECTION_LABELS[reflection.kind]}
        </span>
        <time className='ml-auto text-xs text-neutral-600'>
          {new Date(reflection.createdAt).toLocaleString()}
        </time>
      </div>
      {reflection.note && (
        <p className='whitespace-pre-wrap text-neutral-300'>
          {reflection.note}
        </p>
      )}
    </li>
  )
}

function StateHistoryItem({ transition }: { transition: StateTransition }) {
  return (
    <li className='flex flex-wrap items-center gap-1.5'>
      <span className='uppercase tracking-wide text-neutral-400'>
        {transition.from
          ? `${transition.from} → ${transition.to}`
          : transition.to}
      </span>
      <span className='text-neutral-600'>· {transition.trigger}</span>
      <time className='text-neutral-600'>
        · {new Date(transition.createdAt).toLocaleString()}
      </time>
    </li>
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
    <li className='flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-950/50 p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
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
        {link.relationKind && (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${relationChipClass(
              link.relationKind,
            )}`}
          >
            {RELATION_LABELS[link.relationKind]}
          </span>
        )}
        {link.relation && (
          <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
            {link.relation}
          </span>
        )}
        {/* Provenance (DET-199): keep AI-assisted connections visibly distinct
            from edges the user drew themselves — never blur the two. */}
        {link.proposedBy === 'AI' ? (
          <span className='rounded border border-violet-700/60 bg-violet-950/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300'>
            AI-suggested
          </span>
        ) : (
          <span className='rounded border border-emerald-700/60 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300'>
            You drew this
          </span>
        )}
        <span className='ml-auto rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
          {link.status}
        </span>
      </div>
      {link.rationale && (
        <p className='pl-5 text-xs text-neutral-500'>{link.rationale}</p>
      )}
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
