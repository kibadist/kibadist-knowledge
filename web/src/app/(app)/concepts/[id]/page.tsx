'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { ArticleReader } from '@/components/reader/article-reader'
import {
  api,
  type Certainty,
  type ConceptArticulation,
  type ConceptDomainRow,
  type ConceptLinkEnd,
  type ConceptRetrievalEvent,
  type Reflection,
  type StateTransition,
} from '@/lib/api'
// Humanized labels (DET-304): one source of truth for every enum label.
import {
  CAPTURE_SOURCE_LABELS,
  CERTAINTY_LABELS,
  COGNITIVE_STATE_LABELS,
  CONCEPT_STATUS_LABELS,
  certaintyChipClass,
  GATE_MODE_LABELS,
  LINK_RELATION_LABELS,
  LINK_STATUS_LABELS,
  REFLECTION_KIND_LABELS,
  relationChipClass,
} from '@/lib/labels'

// DET-199: the user's epistemic stance, in their own framing. Order is the
// control's left-to-right options. "Unsure" reads softer here than the bare
// "Uncertain" chip label, so it keeps its own copy.
const CERTAINTY_OPTIONS: { value: Certainty; label: string }[] = [
  { value: 'ASSERTED', label: 'Asserted' },
  { value: 'TENTATIVE', label: 'Tentative' },
  { value: 'UNCERTAIN', label: 'Unsure' },
]

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
    <div className='screen'>
      <div className='page-head'>
        <Link href='/concepts' className='back-link'>
          ← Concepts
        </Link>
        <h1>{concept?.title ?? 'Concept'}</h1>
        {concept && (
          <div className='flex flex-wrap items-center gap-2'>
            <span className='chip chip-quiet'>
              {CONCEPT_STATUS_LABELS[concept.status]}
            </span>
            {concept.cognitiveState && (
              <span className='chip chip-quiet'>
                {COGNITIVE_STATE_LABELS[concept.cognitiveState]}
              </span>
            )}
            {concept.gateMode && (
              <span className='chip chip-quiet'>
                {GATE_MODE_LABELS[concept.gateMode]}
              </span>
            )}
            {/* Uncertainty (DET-199): the user's own stance, shown plainly so
                what they're unsure of is never flattened into implied certainty. */}
            <span className={`chip ${certaintyChipClass(concept.certainty)}`}>
              {CERTAINTY_LABELS[concept.certainty]}
            </span>
            {/* Memory decay (DET-195): current activation, with a DORMANT
                call-out + a Revive control when it has faded past the floor. */}
            <span className='chip chip-quiet'>
              Activation {Math.round(concept.currentActivation * 100)}%
            </span>
            {dormant && <span className='chip chip-pending'>Dormant</span>}
            {contested && (
              <span className='chip chip-contested'>Contested</span>
            )}
            {dormant && (
              <button
                type='button'
                onClick={() => reviveMutation.mutate()}
                disabled={reviveMutation.isPending}
                className='btn-ghost-xs'
              >
                {reviveMutation.isPending ? 'Reviving…' : 'Revive'}
              </button>
            )}
          </div>
        )}
        {reviveMutation.isError && (
          <p className='notice notice-error'>
            Could not revive this concept. Try again.
          </p>
        )}
        {concept && concept.stateHistory.length > 0 && (
          <ol className='u-mono flex flex-col gap-1 text-xs text-ink-muted'>
            {concept.stateHistory.map((t) => (
              <StateHistoryItem key={t.id} transition={t} />
            ))}
          </ol>
        )}
      </div>

      {contested && (
        <div className='callout-contested'>
          <p className='mono-label'>Contested</p>
          <p className='mt-1'>
            This concept conflicts with something else you hold. It&apos;s
            flagged so the tension stays visible until you resolve it.
          </p>
        </div>
      )}

      {conceptQuery.isLoading && <p className='notice'>Loading concept…</p>}
      {conceptQuery.isError && (
        <p className='notice notice-error'>Could not load this concept.</p>
      )}

      {concept && (
        <>
          <section className='doc-section'>
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='panel-h'>Articulations</h2>
                {/* Authorship (DET-199): the Articulations are user-authored —
                    the user's own compression + tutor responses. Tagged so it's
                    unmistakable this is what the user wrote, not AI or source. */}
                <AuthorTag author='USER' />
              </div>
              <p className='block-sub mt-1'>
                Your explanations, in your own words.
              </p>
            </div>
            {concept.articulations.length === 0 ? (
              <p className='notice'>No articulations recorded.</p>
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

          <section className='doc-section'>
            <div>
              <h2 className='panel-h'>Connections</h2>
              <p className='block-sub mt-1'>How this idea relates to others.</p>
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
                return <p className='notice'>No connections yet.</p>
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

          <ConceptDomainsSection conceptId={id} />

          <section className='doc-section'>
            <div>
              <h2 className='panel-h'>Retrieval</h2>
              <p className='block-sub mt-1'>
                Proof you recalled this from memory.
              </p>
            </div>
            {concept.retrievalEvents.length === 0 ? (
              <p className='notice'>No retrieval events yet.</p>
            ) : (
              <ol className='flex flex-col gap-3'>
                {concept.retrievalEvents.map((event, i) => (
                  <RetrievalItem key={event.id} event={event} first={i === 0} />
                ))}
              </ol>
            )}
          </section>

          <section className='doc-section'>
            <div>
              <h2 className='panel-h'>What changed</h2>
              <p className='block-sub mt-1'>
                How your understanding moved over time.
              </p>
            </div>
            {concept.reflections.length === 0 ? (
              <p className='notice'>No reflections recorded yet.</p>
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
          <section className='doc-section'>
            <div>
              <h2 className='panel-h'>How sure are you?</h2>
              <p className='block-sub mt-1'>
                Your understanding has an honest edge. It&apos;s fine to mark
                what you&apos;re still unsure of — uncertainty is information,
                not a gap to hide.
              </p>
            </div>
            <div className='seg-row'>
              {CERTAINTY_OPTIONS.map((option) => {
                const active = concept.certainty === option.value
                return (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => certaintyMutation.mutate(option.value)}
                    disabled={certaintyMutation.isPending}
                    className={`seg${active ? ' on' : ''}`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {certaintyMutation.isError && (
              <p className='notice notice-error'>
                Could not update certainty. Try again.
              </p>
            )}
            {/* Evidence density (DET-199): a second, objective uncertainty
                signal beyond the user's own stance — how many of their own
                compressions back this concept. A cheap, honest proxy; richer
                source-citation counting is a deferred refinement (server). */}
            <div className='flex flex-wrap items-center gap-2 border-t border-[var(--rule-soft)] pt-3'>
              <span className='chip chip-quiet'>
                Evidence {concept.evidenceDensity}
              </span>
              <p className='block-sub'>
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
          <section className='doc-section'>
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='panel-h'>Provenance</h2>
                {/* Authorship (DET-199): the source material is quoted, not
                    written by the user or the AI — tagged distinctly so it's
                    never mistaken for earned, user-authored knowledge. */}
                <AuthorTag author='SOURCE' />
              </div>
              <p className='block-sub mt-1'>
                The source below is where this came from — provenance, not the
                concept. The concept itself is your own articulation, compressed
                from this material in your words.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {concept.captureSource && (
                <span className='chip chip-quiet'>
                  {CAPTURE_SOURCE_LABELS[concept.captureSource]}
                </span>
              )}
              {concept.sourceUrl ? (
                <a
                  href={concept.sourceUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='row-url'
                >
                  {concept.sourceUrl}
                </a>
              ) : (
                <span className='notice'>
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
    className: 'chip-cleared',
  },
  AI: {
    label: 'AI-assisted',
    className: 'chip-ai',
  },
  SOURCE: {
    label: 'Source — quoted',
    className: 'chip-quiet',
  },
}

function AuthorTag({ author }: { author: Author }) {
  const { label, className } = AUTHOR_TAGS[author]
  return <span className={`chip ${className}`}>{label}</span>
}

function ReflectionItem({ reflection }: { reflection: Reflection }) {
  return (
    <li className='item-card flex flex-col gap-1 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='chip chip-quiet'>
          {REFLECTION_KIND_LABELS[reflection.kind]}
        </span>
        <time className='u-mono ml-auto text-xs text-ink-faint'>
          {new Date(reflection.createdAt).toLocaleString()}
        </time>
      </div>
      {reflection.note && (
        <p className='whitespace-pre-wrap text-ink-soft'>{reflection.note}</p>
      )}
    </li>
  )
}

function StateHistoryItem({ transition }: { transition: StateTransition }) {
  return (
    <li className='flex flex-wrap items-center gap-1.5'>
      <span className='tracking-wide text-ink-muted'>
        {transition.from
          ? `${COGNITIVE_STATE_LABELS[transition.from]} → ${COGNITIVE_STATE_LABELS[transition.to]}`
          : COGNITIVE_STATE_LABELS[transition.to]}
      </span>
      <span className='text-ink-faint'>· {transition.trigger}</span>
      <time className='text-ink-faint'>
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
    <li className='item-card'>
      <div className='mb-1 flex items-center gap-2'>
        {canonical && <span className='chip chip-cleared'>Canonical</span>}
        <time className='u-mono text-xs text-ink-faint'>
          {new Date(articulation.createdAt).toLocaleString()}
        </time>
      </div>
      <p className='whitespace-pre-wrap text-sm text-ink'>
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
    <li className='item-card flex flex-col gap-1 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-ink-muted'>{direction}</span>
        {other ? (
          <Link
            href={`/concepts/${other.id}`}
            className='font-medium text-ink hover:underline'
          >
            {other.title}
          </Link>
        ) : (
          <span className='text-ink-muted'>Unknown concept</span>
        )}
        {link.relationKind && (
          <span className={`chip ${relationChipClass(link.relationKind)}`}>
            {LINK_RELATION_LABELS[link.relationKind]}
          </span>
        )}
        {link.relation && (
          <span className='chip chip-quiet'>{link.relation}</span>
        )}
        {/* Provenance (DET-199): keep AI-assisted connections visibly distinct
            from edges the user drew themselves — never blur the two. */}
        {link.proposedBy === 'AI' ? (
          <span className='chip chip-ai'>AI-suggested</span>
        ) : (
          <span className='chip chip-cleared'>You drew this</span>
        )}
        <span className='chip chip-quiet ml-auto'>
          {LINK_STATUS_LABELS[link.status]}
        </span>
      </div>
      {link.rationale && (
        <p className='pl-5 text-xs text-ink-muted'>{link.rationale}</p>
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
    <li className='item-card'>
      <div className='mb-2 flex items-center gap-2'>
        {first && <span className='chip chip-cleared'>First retrieval</span>}
        {event.score !== null && (
          <span className='chip chip-quiet'>Score {event.score}/5</span>
        )}
        <time className='u-mono ml-auto text-xs text-ink-faint'>
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
      {event.question && (
        <p className='text-sm font-medium text-ink'>{event.question}</p>
      )}
      {event.response && (
        <p className='mt-1 whitespace-pre-wrap text-sm text-ink-soft'>
          {event.response}
        </p>
      )}
    </li>
  )
}

/**
 * Domains a concept belongs to (DET-238). Validated memberships render as solid
 * chips; AI suggestions (createdBy AI, not yet validated) render dashed/"suggested"
 * with accept/dismiss — the SAME suggested-vs-validated grammar the map uses for
 * AI link proposals. Tagging is organization metadata: accepting a suggestion
 * flips `userValidated`, it never promotes the concept or touches its cognitive
 * state / the gate (DET-189).
 */
function ConceptDomainsSection({ conceptId }: { conceptId: string }) {
  const queryClient = useQueryClient()
  const membershipsQuery = useQuery({
    queryKey: ['concept-domains', conceptId],
    queryFn: () => api.listConceptDomains(conceptId),
  })
  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: api.listDomains,
  })
  const [adding, setAdding] = useState('')

  // After any membership change, refresh this list AND any domain-scoped graph
  // counts (the domains list shows live counts from the DOMAIN scope).
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['concept-domains', conceptId] })
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'graph' && q.queryKey[1] === 'domain',
    })
  }

  const suggest = useMutation({
    mutationFn: () => api.suggestConceptDomains(conceptId),
    onSuccess: refresh,
  })
  const tag = useMutation({
    mutationFn: (domainId: string) =>
      api.tagConceptDomain(conceptId, { domainId }),
    onSuccess: () => {
      setAdding('')
      refresh()
    },
  })
  const validate = useMutation({
    mutationFn: (domainId: string) =>
      api.validateConceptDomain(conceptId, domainId),
    onSuccess: refresh,
  })
  const untag = useMutation({
    mutationFn: (domainId: string) =>
      api.untagConceptDomain(conceptId, domainId),
    onSuccess: refresh,
  })

  const memberships = membershipsQuery.data ?? []
  const taggedIds = new Set(memberships.map((m) => m.domainId))
  const available = (domainsQuery.data ?? []).filter(
    (d) => !taggedIds.has(d.id),
  )

  const isSuggested = (m: ConceptDomainRow) =>
    m.createdBy === 'AI' && !m.userValidated

  return (
    <section className='doc-section'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='panel-h'>Domains</h2>
        <button
          type='button'
          className='btn-ghost-xs'
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending}
        >
          {suggest.isPending ? 'Suggesting…' : 'Suggest with AI'}
        </button>
      </div>
      <p className='block-sub mt-1'>
        Semantic regions this concept belongs to. AI suggestions are dashed
        until you accept them — organization, never a change to what you’ve
        earned.
      </p>

      {memberships.length === 0 ? (
        <p className='notice'>Not in any domain yet.</p>
      ) : (
        <ul className='domain-chip-row'>
          {memberships.map((m) => {
            const suggested = isSuggested(m)
            return (
              <li key={m.domainId}>
                <span
                  className={`domain-chip${suggested ? ' is-suggested' : ''}`}
                >
                  <span
                    className='domain-chip-dot'
                    style={{ background: m.domain.color ?? 'var(--rule-soft)' }}
                    aria-hidden
                  />
                  {m.domain.name}
                  {suggested && (
                    <span className='domain-chip-tag'>suggested</span>
                  )}
                  {suggested ? (
                    <>
                      <button
                        type='button'
                        className='domain-chip-act accept'
                        title='Accept this domain'
                        onClick={() => validate.mutate(m.domainId)}
                      >
                        ✓
                      </button>
                      <button
                        type='button'
                        className='domain-chip-act dismiss'
                        title='Dismiss this suggestion'
                        onClick={() => untag.mutate(m.domainId)}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <button
                      type='button'
                      className='domain-chip-act dismiss'
                      title='Remove from this domain'
                      onClick={() => untag.mutate(m.domainId)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {available.length > 0 && (
        <div className='track-add-row mt-3'>
          <select
            className='fld'
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value=''>Add to a domain…</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type='button'
            className='btn-primary'
            disabled={!adding || tag.isPending}
            onClick={() => tag.mutate(adding)}
          >
            {tag.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
    </section>
  )
}
