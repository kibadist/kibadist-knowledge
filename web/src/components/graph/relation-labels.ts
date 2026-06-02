import type { LinkRelation } from '@/lib/api'

// The Connector's typed-relationship vocabulary, curated for display. Shared by
// the map's edge labels AND the inspector so the same relation never reads as a
// raw enum (DEPENDS_ON) in one place and a curated label ("depends on") two feet
// away (DET-223). Matches the concept detail view's vocabulary.
export const RELATION_LABELS: Record<LinkRelation, string> = {
  ANALOGY: 'analogy',
  CONTRADICTION: 'contradiction',
  SUPPORTS: 'supports',
  DEPENDS_ON: 'depends on',
  REFINES: 'refines',
  REDUNDANT: 'redundant',
}

// The chip variant a relation reads as: contradictions are the hot signal,
// redundancy is muted, everything else stays quiet.
export function relationChipClass(kind: LinkRelation): string {
  if (kind === 'CONTRADICTION') return 'chip-contested'
  if (kind === 'REDUNDANT') return 'chip-pending'
  return 'chip-quiet'
}
