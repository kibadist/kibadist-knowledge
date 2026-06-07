import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'

import { api, type ConceptLinkEnd, type LinkRelation } from '@/lib/api'
// Humanized labels (DET-304): one source of truth for every enum label.
import {
  CERTAINTY_LABELS,
  COGNITIVE_STATE_LABELS,
  LINK_RELATION_LABELS,
  LINK_STATUS_LABELS,
  livingConceptStatusChip,
  relationChipClass,
} from '@/lib/labels'

/**
 * The map's right-hand inspector. On a selected node it shows the concept's
 * summary, source excerpt, cognitive state + certainty, its links (with
 * validate/reject for suggested edges), and its Living Concept persona — always
 * marked as an AI scaffold, never blurred with earned knowledge.
 */
export function GraphInspector({
  conceptId,
  onClose,
}: {
  conceptId: string | null
  onClose: () => void
}) {
  if (!conceptId) {
    return (
      <aside className='graph-inspector'>
        <p className='notice'>Select a concept on the map to inspect it.</p>
      </aside>
    )
  }
  return (
    <InspectorBody key={conceptId} conceptId={conceptId} onClose={onClose} />
  )
}

function InspectorBody({
  conceptId,
  onClose,
}: {
  conceptId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const conceptQuery = useQuery({
    queryKey: ['concept', conceptId],
    queryFn: () => api.getConcept(conceptId),
  })
  const livingQuery = useQuery({
    queryKey: ['living', conceptId],
    queryFn: () => api.getLivingConcept(conceptId),
  })

  // Validating or rejecting a suggested link changes the graph's edges and the
  // concept's link lists — refresh both.
  const invalidateLinks = () => {
    void queryClient.invalidateQueries({ queryKey: ['graph'] })
    void queryClient.invalidateQueries({ queryKey: ['concept', conceptId] })
  }
  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.confirmLink(id),
    onSuccess: invalidateLinks,
  })
  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectLink(id),
    onSuccess: invalidateLinks,
  })

  const createPersonaMutation = useMutation({
    mutationFn: () => api.createLivingConcept(conceptId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['living', conceptId] })
      void queryClient.invalidateQueries({ queryKey: ['graph'] })
    },
  })
  const validatePersonaMutation = useMutation({
    mutationFn: (id: string) =>
      api.updateLivingConcept(id, { status: 'USER_VALIDATED' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['living', conceptId] })
    },
  })
  // Archiving retires a persona: it leaves the map (no "Living" chip) and this
  // card, but the row survives so re-creating it revives it to DRAFT (DET-227).
  const archivePersonaMutation = useMutation({
    mutationFn: (id: string) =>
      api.updateLivingConcept(id, { status: 'ARCHIVED' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['living', conceptId] })
      void queryClient.invalidateQueries({ queryKey: ['graph'] })
    },
  })

  const concept = conceptQuery.data
  const living = livingQuery.data
  // An ARCHIVED persona is treated as retired/absent: hidden from the card, with
  // the Create control offered again (which revives it server-side) (DET-227).
  const activePersona = living && living.status !== 'ARCHIVED' ? living : null

  const linkBusy = confirmMutation.isPending || rejectMutation.isPending

  return (
    <aside className='graph-inspector'>
      <div className='graph-inspector-head'>
        <span className='section-label'>§ Concept</span>
        <button type='button' onClick={onClose} className='btn-ghost-xs'>
          Close
        </button>
      </div>

      {conceptQuery.isLoading && <p className='notice'>Loading concept…</p>}
      {conceptQuery.isError && (
        <p className='notice notice-error'>Could not load this concept.</p>
      )}

      {concept && (
        <>
          <div className='graph-inspector-title'>
            <Link href={`/concepts/${concept.id}`} className='row-title'>
              {concept.title}
            </Link>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='chip chip-quiet'>
                {COGNITIVE_STATE_LABELS[concept.cognitiveState]}
              </span>
              <span className='chip chip-quiet'>
                {CERTAINTY_LABELS[concept.certainty]}
              </span>
              <span className='chip chip-quiet'>
                Activation {Math.round(concept.currentActivation * 100)}%
              </span>
            </div>
          </div>

          {concept.summary && <p className='block-sub'>{concept.summary}</p>}

          {/* Links: validate/reject suggested edges directly from the map. */}
          <section className='graph-inspector-section'>
            <h3 className='panel-h'>Connections</h3>
            <LinkList
              outgoing={concept.outgoingLinks}
              incoming={concept.incomingLinks}
              onConfirm={(id) => confirmMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
              busy={linkBusy}
              relationLabels={LINK_RELATION_LABELS}
              relationChipClass={relationChipClass}
            />
          </section>

          {/* Living Concept: a persona scaffold, never earned knowledge. The
              section is always tagged as scaffold; the DRAFT/Validated state is
              shown by the per-persona chip next to its name, and a DRAFT persona
              shows a Validate control. */}
          <section className='graph-inspector-section'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='panel-h'>Living Concept</h3>
              <span className='chip chip-ai'>
                {activePersona && activePersona.createdBy === 'USER'
                  ? 'Scaffold'
                  : 'AI scaffold'}
              </span>
            </div>

            {livingQuery.isLoading && (
              <p className='notice'>Loading persona…</p>
            )}

            {!livingQuery.isLoading && !activePersona && (
              <>
                <p className='block-sub'>
                  {living?.status === 'ARCHIVED'
                    ? 'This Living Concept was archived. Re-creating it revives the persona as a fresh draft to think with — still a scaffold, never earned knowledge.'
                    : 'No persona yet. A Living Concept gives this idea a voice and a core metaphor — an AI scaffold to think with, never earned knowledge.'}
                </p>
                <button
                  type='button'
                  onClick={() => createPersonaMutation.mutate()}
                  disabled={createPersonaMutation.isPending}
                  className='btn-ghost-xs'
                >
                  {createPersonaMutation.isPending
                    ? living?.status === 'ARCHIVED'
                      ? 'Reviving…'
                      : 'Creating…'
                    : living?.status === 'ARCHIVED'
                      ? 'Revive Living Concept'
                      : 'Create Living Concept'}
                </button>
                {createPersonaMutation.isError && (
                  <p className='notice notice-error'>
                    Could not create a persona. Try again.
                  </p>
                )}
              </>
            )}

            {activePersona && (
              <div className='living-card'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='living-name'>
                    {activePersona.personaName}
                  </span>
                  {(() => {
                    const c = livingConceptStatusChip(activePersona.status)
                    return (
                      <span className={`chip ${c.className}`}>{c.label}</span>
                    )
                  })()}
                </div>
                <p className='block-sub'>{activePersona.personaSummary}</p>
                {activePersona.voice && (
                  <p className='living-field'>
                    <span className='mono-label'>Voice</span>
                    {activePersona.voice}
                  </p>
                )}
                {activePersona.coreMetaphor && (
                  <p className='living-field'>
                    <span className='mono-label'>Core metaphor</span>
                    {activePersona.coreMetaphor}
                  </p>
                )}
                {activePersona.metaphorBreaks && (
                  <p className='living-field'>
                    <span className='mono-label'>Where it breaks</span>
                    {activePersona.metaphorBreaks}
                  </p>
                )}
                {/* Persona actions: validate a DRAFT, and archive (retire) any
                    active persona. Archiving removes it from the map + this card;
                    re-creating later revives it to DRAFT (DET-227). */}
                <div className='flex flex-wrap gap-2'>
                  {activePersona.status === 'DRAFT' && (
                    <button
                      type='button'
                      onClick={() =>
                        validatePersonaMutation.mutate(activePersona.id)
                      }
                      disabled={validatePersonaMutation.isPending}
                      className='btn-ghost-xs'
                    >
                      {validatePersonaMutation.isPending
                        ? 'Validating…'
                        : 'Validate persona'}
                    </button>
                  )}
                  <button
                    type='button'
                    onClick={() =>
                      archivePersonaMutation.mutate(activePersona.id)
                    }
                    disabled={archivePersonaMutation.isPending}
                    className='btn-ghost-xs'
                  >
                    {archivePersonaMutation.isPending
                      ? 'Archiving…'
                      : 'Archive'}
                  </button>
                </div>
                {validatePersonaMutation.isError && (
                  <p className='notice notice-error'>
                    Could not validate. Try again.
                  </p>
                )}
                {archivePersonaMutation.isError && (
                  <p className='notice notice-error'>
                    Could not archive. Try again.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Provenance: the source excerpt this concept was compressed from. */}
          {concept.sourceText && (
            <section className='graph-inspector-section'>
              <h3 className='panel-h'>Source excerpt</h3>
              <p className='source-excerpt'>
                {concept.sourceText.slice(0, 400)}
                {concept.sourceText.length > 400 ? '…' : ''}
              </p>
            </section>
          )}
        </>
      )}
    </aside>
  )
}

function LinkList({
  outgoing,
  incoming,
  onConfirm,
  onReject,
  busy,
  relationLabels,
  relationChipClass: relationClass,
}: {
  outgoing: ConceptLinkEnd[]
  incoming: ConceptLinkEnd[]
  onConfirm: (id: string) => void
  onReject: (id: string) => void
  busy: boolean
  relationLabels: Record<LinkRelation, string>
  relationChipClass: (kind: LinkRelation) => string
}) {
  // REJECTED ends are dismissed — never shown. SUGGESTED + CONFIRMED remain.
  const visibleOut = outgoing.filter((l) => l.status !== 'REJECTED')
  const visibleIn = incoming.filter((l) => l.status !== 'REJECTED')

  if (visibleOut.length === 0 && visibleIn.length === 0) {
    return <p className='notice'>No connections yet.</p>
  }

  return (
    <ul className='flex flex-col gap-2'>
      {visibleOut.map((link) => (
        <LinkRow
          key={link.id}
          link={link}
          other={link.targetConcept}
          direction='→'
          onConfirm={onConfirm}
          onReject={onReject}
          busy={busy}
          relationLabels={relationLabels}
          relationChipClass={relationClass}
        />
      ))}
      {visibleIn.map((link) => (
        <LinkRow
          key={link.id}
          link={link}
          other={link.sourceConcept}
          direction='←'
          onConfirm={onConfirm}
          onReject={onReject}
          busy={busy}
          relationLabels={relationLabels}
          relationChipClass={relationClass}
        />
      ))}
    </ul>
  )
}

function LinkRow({
  link,
  other,
  direction,
  onConfirm,
  onReject,
  busy,
  relationLabels,
  relationChipClass: relationClass,
}: {
  link: ConceptLinkEnd
  other?: { id: string; title: string }
  direction: string
  onConfirm: (id: string) => void
  onReject: (id: string) => void
  busy: boolean
  relationLabels: Record<LinkRelation, string>
  relationChipClass: (kind: LinkRelation) => string
}) {
  const suggested = link.status === 'SUGGESTED'
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
          <span className={`chip ${relationClass(link.relationKind)}`}>
            {relationLabels[link.relationKind]}
          </span>
        )}
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
      {suggested && (
        <div className='flex flex-wrap gap-2 pl-5 pt-1'>
          <button
            type='button'
            onClick={() => onConfirm(link.id)}
            disabled={busy}
            className='btn-ghost-xs'
          >
            Validate
          </button>
          <button
            type='button'
            onClick={() => onReject(link.id)}
            disabled={busy}
            className='btn-ghost-xs'
          >
            Reject
          </button>
        </div>
      )}
    </li>
  )
}
