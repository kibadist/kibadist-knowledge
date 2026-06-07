import type {
  CandidateKind,
  CaptureSource,
  Certainty,
  CognitiveState,
  ConceptStatus,
  FrictionLevel,
  GateMode,
  LinkRelation,
  LivingConceptStatus,
  ReflectionKind,
  SessionItemReason,
} from '@/lib/api'

/**
 * Humanized enum labels (DET-304, finishing DET-241).
 *
 * The API speaks in SHOUTING enums (DEPENDS_ON, SUGGESTED, RIGOROUS); the UI
 * reads like prose. This is the SINGLE source of those human labels — every
 * screen imports from here so the same enum never reads as a curated label in
 * one place and a raw enum two feet away. No JSX should ever render a raw enum
 * value directly; route it through one of these maps (guarded by labels.spec.ts).
 */

// The link's lifecycle status (DET-191). No named type on the API yet — the
// interfaces inline this union — so it's declared here, the one place it's
// humanized. SUGGESTED proposals and CONFIRMED/REJECTED outcomes.
export type LinkStatus = 'SUGGESTED' | 'CONFIRMED' | 'REJECTED'

// The full cognitive-state lifecycle (DET-194), title-cased for display.
export const COGNITIVE_STATE_LABELS: Record<CognitiveState, string> = {
  SEEN: 'Seen',
  PARSED: 'Parsed',
  EXPLAINED: 'Explained',
  LINKED: 'Linked',
  RETRIEVED: 'Retrieved',
  DEFENDED: 'Defended',
  INTERNALIZED: 'Internalized',
  DORMANT: 'Dormant',
  CONTESTED: 'Contested',
  ARCHIVED: 'Archived',
}

// The user's epistemic stance (DET-199), in their own framing.
export const CERTAINTY_LABELS: Record<Certainty, string> = {
  ASSERTED: 'Asserted',
  TENTATIVE: 'Tentative',
  UNCERTAIN: 'Uncertain',
}

// The chip variant a certainty reads as: unsure is muted-pending, tentative is
// informational, asserted is cleared.
export function certaintyChipClass(certainty: Certainty): string {
  if (certainty === 'UNCERTAIN') return 'chip-pending'
  if (certainty === 'TENTATIVE') return 'chip-info'
  return 'chip-cleared'
}

// The retrieval-pass tier persisted at promotion (DET-189).
export const GATE_MODE_LABELS: Record<GateMode, string> = {
  QUICK: 'Quick gate',
  DEEP: 'Deep gate',
}

// Where a captured source came from (DET-241). Used both as the concept-detail
// provenance chip and the article reader's source eyebrow (via captureSourceLabel).
export const CAPTURE_SOURCE_LABELS: Record<CaptureSource, string> = {
  PASTE: 'Pasted text',
  URL: 'Web article',
  PDF: 'PDF document',
}

// A concept's place in the pipeline (DET-189): captured → articulated → earned.
export const CONCEPT_STATUS_LABELS: Record<ConceptStatus, string> = {
  INBOX: 'Inbox',
  ARTICULATED: 'Articulated',
  PERMANENT: 'Permanent',
}

// Adaptive Friction levels (DET-197). The cognitive weight a captured item must
// earn — surfaced as the friction picker's button labels and the proposal callout.
// Humanized away from the internal SHOUTING enum (DET-305): MINIMAL/LIGHT read as
// product jargon, so the two lightest tiers get plain-language labels ("Quick
// save" / "Standard"). Wire values are unchanged — this is the copy layer only.
export const FRICTION_LEVEL_LABELS: Record<FrictionLevel, string> = {
  MINIMAL: 'Quick save',
  LIGHT: 'Standard',
  DEEP: 'Deep',
  RIGOROUS: 'Rigorous',
}

// A link's lifecycle status (DET-191).
export const LINK_STATUS_LABELS: Record<LinkStatus, string> = {
  SUGGESTED: 'Suggested',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
}

// The Connector's typed-relationship vocabulary (DET-191), curated for display.
// Shared by the map's edge labels, the inspector, the concept detail, and the
// promote flow so the same relation never reads as a raw enum (DEPENDS_ON) in
// one place and a curated label ("depends on") elsewhere (DET-223).
export const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
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

// Living Concept persona status (DET-227): a scaffold's DRAFT/validated/retired
// lifecycle. Returns both the human label and the chip variant it reads as.
export const LIVING_CONCEPT_STATUS_LABELS: Record<LivingConceptStatus, string> =
  {
    DRAFT: 'Draft',
    USER_VALIDATED: 'Validated',
    ARCHIVED: 'Archived',
  }

export function livingConceptStatusChip(status: LivingConceptStatus): {
  className: string
  label: string
} {
  if (status === 'USER_VALIDATED')
    return {
      className: 'chip-cleared',
      label: LIVING_CONCEPT_STATUS_LABELS[status],
    }
  if (status === 'ARCHIVED')
    return {
      className: 'chip-quiet',
      label: LIVING_CONCEPT_STATUS_LABELS[status],
    }
  return {
    className: 'chip-pending',
    label: LIVING_CONCEPT_STATUS_LABELS[status],
  }
}

// What kind of thing an extracted concept candidate is (DET-211). Surfaced as
// the candidate chip in the inbox source view.
export const CANDIDATE_KIND_LABELS: Record<CandidateKind, string> = {
  CONCEPT: 'Concept',
  TERM: 'Term',
  PERSON: 'Person',
  METHOD: 'Method',
  FORMULA: 'Formula',
  THEOREM: 'Theorem',
  APPLICATION: 'Application',
}

// Why a concept surfaced in a session's queue (DET-198).
export const SESSION_ITEM_REASON_LABELS: Record<SessionItemReason, string> = {
  DUE: 'due for review',
  CONTESTED: 'contested — resolve the conflict',
  REDISCOVERY: 'rediscovery',
  CHALLENGE: 'the Tutor will challenge this',
}

// Human labels for the reflection kinds shown in "What changed" (DET-196).
export const REFLECTION_KIND_LABELS: Record<ReflectionKind, string> = {
  CLEARER: 'got clearer',
  LESS_CLEAR: 'less clear',
  CONNECTED: 'connected',
  CHALLENGE_NEXT: 'to challenge',
}
