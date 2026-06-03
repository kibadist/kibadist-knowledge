'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'

import { api, type Domain } from '@/lib/api'
import { useWorkspace } from '@/lib/workspace-context'

/**
 * Domains (DET-238) — the lightweight browse/organize surface for semantic
 * regions. Deliberately secondary to Tracks: domains accrete over time, the user
 * is never forced to organize first. A domain opens its DOMAIN-scoped graph view
 * (DET-236). Pure presentation over the DET-234 endpoints.
 */
export default function DomainsPage() {
  const { activeWorkspaceId } = useWorkspace()
  const domainsQuery = useQuery({
    queryKey: ['domains', activeWorkspaceId],
    queryFn: api.listDomains,
  })
  const domains = domainsQuery.data ?? []

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Domains · Regions</div>
        <h1>Domains</h1>
        {domains.length > 0 && (
          <div className='head-count region'>
            {domains.length} {domains.length === 1 ? 'region' : 'regions'}
          </div>
        )}
        <p className='lede'>
          Semantic regions your knowledge falls into — not folders. A concept
          can live in several. Domains accrue over time; you’re never forced to
          organize first. The AI suggests memberships, you validate them.
        </p>
      </div>

      <NewDomainForm domains={domains} />

      {domainsQuery.isLoading && <p className='notice'>Loading domains…</p>}
      {domainsQuery.isError && (
        <p className='notice notice-error'>Could not load your domains.</p>
      )}

      {!domainsQuery.isLoading && domains.length === 0 && (
        <div className='empty'>
          No domains yet.
          <span>
            Create one above, then tag concepts into it from a concept’s page —
            or let the AI suggest domains for a concept.
          </span>
        </div>
      )}

      {domains.length > 0 && (
        <ul className='rows'>
          {domains.map((domain) => (
            <DomainCard key={domain.id} domain={domain} domains={domains} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One domain row: color swatch, name, live concept count, rename + delete. */
function DomainCard({
  domain,
  domains,
}: {
  domain: Domain
  domains: Domain[]
}) {
  const queryClient = useQueryClient()
  const { activeWorkspaceId } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(domain.name)

  // Concept count = nodes in the DOMAIN-scoped graph (DET-236). Reuses the
  // resolver, so the count updates whenever memberships change and the query is
  // invalidated.
  const countQuery = useQuery({
    queryKey: ['graph', 'domain', domain.id],
    queryFn: () => api.getScopedGraph({ scope: 'DOMAIN', domainId: domain.id }),
  })
  const count = countQuery.data?.nodes.length ?? 0

  const parent = domain.parentDomainId
    ? domains.find((d) => d.id === domain.parentDomainId)
    : null

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['domains', activeWorkspaceId] })

  const rename = useMutation({
    mutationFn: () => api.updateDomain(domain.id, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false)
      invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteDomain(domain.id),
    onSuccess: invalidate,
  })

  return (
    // The domain's color is carried as a left "spine" so the list is scannable
    // by region at a glance (DET-241), rather than via a tiny swatch.
    <li
      className='domain-card'
      style={{
        borderLeftColor: domain.color ?? 'var(--rule)',
        borderLeftWidth: 4,
      }}
    >
      {editing ? (
        <form
          className='domain-edit'
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) rename.mutate()
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: focus the field on edit
            autoFocus
            className='fld fld-sm'
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type='submit'
            className='btn-ghost-xs'
            disabled={!name.trim()}
          >
            Save
          </button>
          <button
            type='button'
            className='btn-ghost-xs'
            onClick={() => {
              setName(domain.name)
              setEditing(false)
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <Link href={`/domains/${domain.id}`} className='domain-main'>
          <span className='domain-name'>{domain.name}</span>
          {parent && <span className='domain-parent'>in {parent.name}</span>}
          <span className='domain-count'>
            {count} {count === 1 ? 'concept' : 'concepts'}
          </span>
        </Link>
      )}
      {!editing && (
        <div className='domain-actions'>
          <button
            type='button'
            className='btn-ghost-xs'
            onClick={() => setEditing(true)}
          >
            Rename
          </button>
          <button
            type='button'
            className='btn-ghost-xs danger'
            onClick={() => {
              if (
                window.confirm(
                  'Delete this domain? Concepts stay — only the domain and its tags are removed.',
                )
              ) {
                remove.mutate()
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

/** Inline "new domain" form: name, optional color, optional parent (nesting). */
function NewDomainForm({ domains }: { domains: Domain[] }) {
  const queryClient = useQueryClient()
  const { activeWorkspaceId } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#8a5a1f')
  const [parentDomainId, setParentDomainId] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createDomain({
        name: name.trim(),
        color,
        parentDomainId: parentDomainId || undefined,
      }),
    onSuccess: () => {
      setName('')
      setParentDomainId('')
      setOpen(false)
      queryClient.invalidateQueries({
        queryKey: ['domains', activeWorkspaceId],
      })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || create.isPending) return
    create.mutate()
  }

  if (!open) {
    return (
      <button
        type='button'
        className='btn-primary track-new-btn'
        onClick={() => setOpen(true)}
      >
        + New domain
      </button>
    )
  }

  return (
    <form className='track-new-form' onSubmit={submit}>
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
        autoFocus
        className='fld'
        placeholder='Domain name — e.g. Distributed Systems'
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
      />
      <div className='domain-new-row'>
        <label className='inline-field'>
          <span>Color</span>
          <input
            type='color'
            className='domain-color'
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <select
          className='fld fld-sm'
          value={parentDomainId}
          onChange={(e) => setParentDomainId(e.target.value)}
        >
          <option value=''>No parent (top-level)</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              Nest under {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className='track-new-actions'>
        <button
          type='submit'
          className='btn-primary'
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create domain'}
        </button>
        <button
          type='button'
          className='btn-ghost-sm'
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      {create.isError && (
        <p className='notice notice-error'>Could not create the domain.</p>
      )}
    </form>
  )
}
