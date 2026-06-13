// Type-only imports: the snake_case learning-event contract (DET-278) is the
// wire shape for `/article-learning/events`. Erased at compile, so the
// api ↔ article-learning-events ↔ article-v2 type cycle has no runtime cost.
import type {
  ArticleLearningEvent,
  ArticleLearningEventDraft,
} from './article-learning-events'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

// NOTE: The access token is kept in localStorage for simplicity. localStorage is
// readable by any injected script (XSS exposure). For production, prefer having
// the server set an httpOnly + Secure + SameSite cookie (@fastify/cookie is
// already a server dependency) and drop client-side token handling.
const TOKEN_KEY = 'kibadist_token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY)
}

// The active workspace (DET-233): which "world" scoped requests act in. Stored
// next to the token so the fetch wrappers below can read it synchronously and
// stamp every request with `X-Workspace-Id` — the server (DET-232) validates it
// and falls back to the user's default workspace when it's absent, so an unset
// value is safe (e.g. before the workspace context has resolved).
const WORKSPACE_KEY = 'kibadist_workspace'

export function getActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(WORKSPACE_KEY)
}

export function setActiveWorkspaceId(id: string): void {
  window.localStorage.setItem(WORKSPACE_KEY, id)
}

export function clearActiveWorkspaceId(): void {
  window.localStorage.removeItem(WORKSPACE_KEY)
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = (await res.json()) as { message?: string | string[] }
      if (data.message) {
        message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message
      }
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const workspaceId = getActiveWorkspaceId()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      // Only declare a JSON content-type when we actually send a body. Fastify
      // rejects an empty body sent with `application/json` (FST_ERR_CTP_EMPTY_
      // JSON_BODY), which would otherwise break bodyless POSTs (e.g. generating
      // interrogation questions, retrieval prompts, marking connections reviewed).
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // The active workspace (DET-233) — scopes the request server-side (DET-232).
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...options.headers,
    },
  })
  return parseResponse<T>(res)
}

// Multipart upload: never set Content-Type — the browser must add the
// multipart boundary itself.
async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken()
  const workspaceId = getActiveWorkspaceId()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: form,
  })
  return parseResponse<T>(res)
}

export interface AuthUser {
  id: string
  email: string
  name: string | null
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

export interface Profile extends AuthUser {
  createdAt: string
}

// A Workspace (DET-232/233): the "world" a body of knowledge belongs to — the
// tenancy container that owns concepts. The active one scopes every request.
export interface Workspace {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export type CaptureSource = 'PASTE' | 'URL' | 'PDF'

// --- Structured source document (DET-210) ---
// Mirrors server/src/source-document/source-document.types.ts. Keep in sync.
export type InlineMark = 'bold' | 'italic' | 'code' | 'strikethrough'

export interface InlineRun {
  text: string
  marks?: InlineMark[]
  href?: string
}

export type SourceBlock =
  | { id: string; type: 'heading'; level: number; text: string }
  | { id: string; type: 'paragraph'; runs: InlineRun[] }
  | { id: string; type: 'quote'; runs: InlineRun[] }
  | { id: string; type: 'list'; ordered: boolean; items: InlineRun[][] }
  | { id: string; type: 'code'; text: string; language?: string }
  | { id: string; type: 'image'; src: string; alt?: string; caption?: string }
  | { id: string; type: 'table'; header: boolean; rows: string[][] }

export type SourceBlockType = SourceBlock['type']

export interface SourceDocument {
  version: 1
  title?: string
  dek?: string
  byline?: string
  canonicalUrl?: string
  blocks: SourceBlock[]
  extractor:
    | 'html-heuristic@1'
    | 'pdf-paragraph@1'
    | 'text-markdown@1'
    | 'readability@1'
    | 'mediawiki@1'
  degraded: boolean
}

/** A captured source's progress through the learning loop (DET-316): read →
 *  recalled → kept, derived server-side from the latest article's events. */
export interface InboxLearningStages {
  read: boolean
  recalled: boolean
  kept: boolean
}

export interface InboxItem {
  id: string
  title: string
  captureSource: CaptureSource | null
  sourceUrl: string | null
  /** Set when this capture was validated out of a source-preserving article
   *  (DET-283) — drives the "from article" badge + backlink. */
  originArticleId: string | null
  /** Unified capture (DET-300): the TransformerSource captured alongside this
   *  item, so the row can open the source pipeline. Null for forged merges and
   *  pre-DET-300 captures. */
  sourceId: string | null
  /** The companion source's latest generated article + status (DET-300): drives
   *  the row's "Read" action once the pipeline produces an article. */
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
  /** Per-source learning progress (DET-316); null until a companion article. */
  learning: InboxLearningStages | null
  excerpt: string
  /** Word count of the raw material — drives the row's read-time signal. */
  wordCount: number
  createdAt: string
}

export interface InboxItemDetail extends InboxItem {
  sourceText: string | null
  sourceDocument: SourceDocument | null
}

// --- Semantic Chunking + Concept Library (DET-211) ---
// A section-sized learnable unit carved from a structured article. Mirrors the
// server's ConceptChunk (chunk-document.util.ts); keep in sync.
export interface ConceptChunk {
  id: string
  title: string
  blocks: SourceBlock[]
  blockIds: string[]
  wordCount: number
}

// --- Concept Library: persisted classification + candidates (DET-211) ---
// Everything here is SCAFFOLD / source material, never an earned Concept. A
// candidate's `definition` is a source-grounded gloss shown as CONTEXT — it never
// prefills the user's articulation (DET-190). Mirrors the server DTOs; keep in sync.
export type ChunkKind =
  | 'MAIN_IDEA'
  | 'DEFINITION'
  | 'EXAMPLE'
  | 'APPLICATION'
  | 'HISTORY'
  | 'REFERENCE'
  | 'NOISE'
  | 'OTHER'
export type ChunkImportance = 'CORE' | 'SUPPORTING' | 'PERIPHERAL'
export type CandidateKind =
  | 'CONCEPT'
  | 'TERM'
  | 'PERSON'
  | 'METHOD'
  | 'FORMULA'
  | 'THEOREM'
  | 'APPLICATION'
export type CandidateImportance =
  | 'CORE'
  | 'SUPPORTING'
  | 'PREREQUISITE'
  | 'PERIPHERAL'
export type Generator = 'SYSTEM' | 'AI' | 'USER'
export type CandidatePromotionStatus = 'CANDIDATE' | 'DISMISSED' | 'PROMOTED'

// A classified, section-sized chunk persisted for the library.
export interface SourceChunk {
  id: string
  conceptId: string
  title: string | null
  summary: string | null
  blockIds: string[]
  kind: ChunkKind
  importance: ChunkImportance
  position: number
}

// A candidate concept extracted from a chunk. NEVER an earned Concept.
export interface SourceConceptCandidate {
  id: string
  conceptId: string
  chunkId: string | null
  label: string
  definition: string | null
  aliases: string[]
  sourceBlockIds: string[]
  kind: CandidateKind
  importance: CandidateImportance
  generatedBy: Generator
  promotionStatus: CandidatePromotionStatus
}

export interface ConceptLibrary {
  conceptId: string
  chunks: SourceChunk[]
  candidates: SourceConceptCandidate[]
  // Soft-deleted candidates (DET-309): dismissal is recoverable, so the library
  // returns dismissed candidates separately for a restorable "Dismissed" group.
  dismissedCandidates: SourceConceptCandidate[]
}

export interface IntakeQuestion {
  id: string
  conceptId: string
  prompt: string
  kind: string | null
  answer: string | null
  order: number
}

// --- Proof-of-Learning Gate (DET-189) ---
// Retained for Concept.gateMode (the retrieval-pass tier persisted at promotion).
export type GateMode = 'QUICK' | 'DEEP'
// Adaptive Friction (DET-197). The cognitive weight a captured item must earn.
// Mirrors the server's FrictionLevel enum; keep in sync.
export type FrictionLevel = 'MINIMAL' | 'LIGHT' | 'DEEP' | 'RIGOROUS'
// The Connector's typed relationship vocabulary (DET-191). Mirrors the server's
// LinkRelation enum; keep in sync.
export type LinkRelation =
  | 'ANALOGY'
  | 'CONTRADICTION'
  | 'SUPPORTS'
  | 'DEPENDS_ON'
  | 'REFINES'
  | 'REDUNDANT'
// The full cognitive-state lifecycle (DET-194). Mirrors the server's
// CognitiveState enum; keep in sync.
export type CognitiveState =
  | 'SEEN'
  | 'PARSED'
  | 'EXPLAINED'
  | 'LINKED'
  | 'RETRIEVED'
  | 'DEFENDED'
  | 'INTERNALIZED'
  | 'DORMANT'
  | 'CONTESTED'
  | 'ARCHIVED'
export type ConceptStatus = 'INBOX' | 'ARTICULATED' | 'PERMANENT'
// How sure the user is of a concept (DET-199). Uncertainty is expressible rather
// than flattened to implied certainty. Mirrors the server's Certainty enum.
export type Certainty = 'ASSERTED' | 'TENTATIVE' | 'UNCERTAIN'

export interface GateChecklist {
  articulate: boolean
  connect: boolean
  retrieve: boolean
  validate: boolean
  ready: boolean
  cognitiveState: CognitiveState
}

export interface PromotionDraft {
  conceptId: string
  // Adaptive Friction (DET-197): the user's CURRENT chosen depth.
  frictionLevel: FrictionLevel
  articulation: string | null
  connectionsReviewed: boolean
  retrievalQuestion: string | null
  retrievalResponse: string | null
  retrievalScore: number | null
}

// --- Reference Q&A (DET-208) ---
export type QuestionActor = 'USER' | 'AI'
export type AnswerKind =
  | 'REFERENCE_SCAFFOLD'
  | 'USER_ATTEMPT'
  | 'VALIDATED_ARTICULATION'

// A grounding citation: a verbatim quote, optionally attributed to the
// structured source block it came from (DET-210).
export interface ReferenceCitation {
  quote: string
  blockId?: string
}

// A question asked while reading a source, optionally AI-answered as a
// source-grounded scaffold. NEVER knowledge — provenance is explicit so the UI
// can label scaffold distinctly from earned articulations.
export interface SourceQuestion {
  id: string
  conceptId: string
  askedBy: QuestionActor
  questionText: string
  answerText: string | null
  answeredBy: QuestionActor | null
  answerKind: AnswerKind | null
  citations: ReferenceCitation[]
  createdAt: string
}

// Read-only prior Q&A surfaced to the promote/compression wizard as reference
// scaffold. It must never prefill the user's articulation.
export interface ReferenceQa {
  questionText: string
  answerText: string
}

// Compression quality signal (DET-190). Flags when an articulation is a verbatim
// copy of the source so the UI can nudge the user to rephrase. Mirrors the
// server's CompressionSignal; keep in sync.
export interface CompressionSignal {
  verbatim: boolean
  sourceOverlap: number
  message: string | null
}

export interface PromotionState {
  conceptId: string
  title: string
  sourceText: string | null
  sourceDocument: SourceDocument | null
  draft: PromotionDraft
  checklist: GateChecklist
  compression: CompressionSignal
  // Adaptive Friction (DET-197): the CURRENT chosen level + the system's
  // suggestion with human-readable reasoning. The user may escalate/de-escalate.
  frictionLevel: FrictionLevel
  frictionProposal: { level: FrictionLevel; reasons: string[] }
  referenceQa: ReferenceQa[]
  // Concept Library handoff (DET-211): when promotion is opened from a candidate,
  // its label + source-grounded definition are surfaced as DISPLAY-ONLY reference
  // context. It is NEVER prefilled into the articulation (DET-190).
  candidateContext?: { label: string; definition: string | null }
}

export interface SuggestedConnection {
  targetConceptId: string
  title: string
  similarity: number
  snippet: string
  // The Connector's typed relationship proposal + rationale (DET-191).
  relationKind: LinkRelation
  rationale: string
}

export interface RetrievalGrade {
  score: number
  passed: boolean
  feedback: string | null
}

export interface ConnectionInput {
  targetConceptId: string
  relation?: string
  // The typed relationship the user accepted from a Connector proposal (DET-191).
  relationKind?: LinkRelation
}

export interface CommitPromotionInput {
  // The gate depth is derived server-side from the draft's frictionLevel (DET-197)
  // — it is not sent here, so a client can't smuggle a lighter gate at commit.
  isRoot: boolean
  connections: ConnectionInput[]
}

export interface Concept {
  id: string
  title: string
  summary: string | null
  sourceText: string | null
  sourceDocument: SourceDocument | null
  captureSource: CaptureSource | null
  sourceUrl: string | null
  status: ConceptStatus
  // The user's epistemic stance (DET-199). Always set (defaults to ASSERTED).
  certainty: Certainty
  // Always set since DET-194: a concept is SEEN at capture and advances from
  // there, so this is never null.
  cognitiveState: CognitiveState
  gateMode: GateMode | null
  // Memory decay (DET-195): the concept's CURRENT activation — its stored
  // prominence decayed by the time since it was last engaged, clamped to [0, 1].
  // Below 0.5 the UI fades it; a DORMANT concept has decayed past the floor.
  currentActivation: number
  createdAt: string
  updatedAt: string
}

export interface ConceptLinkEnd {
  id: string
  status: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED'
  relation: string | null
  // The Connector's typed relationship + rationale (DET-191). Null on
  // pre-DET-191 links or bare user-drawn edges with no kind.
  relationKind: LinkRelation | null
  rationale: string | null
  // Who drew this edge (DET-199): the Connector (AI) proposed it, or the user
  // drew it. Lets the UI tag AI-assisted connections distinctly from user-drawn
  // ones so AI-authored content is never blurred into user-authored knowledge.
  proposedBy: QuestionActor
  targetConcept?: { id: string; title: string }
  sourceConcept?: { id: string; title: string }
}

export interface ConceptArticulation {
  id: string
  body: string
  createdAt: string
}

export interface ConceptRetrievalEvent {
  id: string
  question: string | null
  response: string | null
  score: number | null
  createdAt: string
}

// One recorded cognitive-state move (DET-194). `from` is null only for the
// opening capture transition.
export interface StateTransition {
  id: string
  from: CognitiveState | null
  to: CognitiveState
  trigger: string
  note: string | null
  createdAt: string
}

// --- Reflection (DET-196) ---
// What MOVED in the user's understanding, each mapping to a downstream effect.
// Mirrors the server's ReflectionKind enum; keep in sync.
export type ReflectionKind =
  | 'CLEARER'
  | 'LESS_CLEAR'
  | 'CONNECTED'
  | 'CHALLENGE_NEXT'

// One recorded reflection, for the concept's "what changed" view.
export interface Reflection {
  id: string
  kind: ReflectionKind
  note: string | null
  createdAt: string
  sessionId?: string
}

export interface ConceptDetail extends Concept {
  articulations: ConceptArticulation[]
  outgoingLinks: ConceptLinkEnd[]
  incomingLinks: ConceptLinkEnd[]
  retrievalEvents: ConceptRetrievalEvent[]
  stateHistory: StateTransition[]
  reflections: Reflection[]
  // Spaced-retrieval reps (DET-192): consecutive successful recalls since the
  // last miss. The deepen nudge (DET-311) uses it to tell a lightly-earned
  // concept that keeps surviving recalls from one that hasn't yet.
  reviewReps: number
  // Uncertainty signal (DET-199): how many of the user's supporting
  // compressions (Articulations) back this concept — a cheap, honest proxy for
  // how well-supported it is, beyond the user's own `certainty`. A richer
  // source-citation count is a deferred refinement (see ConceptsService.findOne).
  evidenceDensity: number
}

// --- Retrieval Engine (DET-192) ---
// Card types mirror the server's RetrievalCardType; keep in sync. Cards are
// always generated from the user's compression (their articulation) + approved
// edges, NEVER from the source — `fromCompression` is the surfaced guarantee.
export type RetrievalCardType = 'CLOZE' | 'EXPLAIN' | 'CONNECT' | 'BOUNDARY'

export interface RetrievalCard {
  type: RetrievalCardType
  prompt: string
  // The expected answer where one is well-defined (CLOZE); null for open cards.
  answer: string | null
  fromCompression: true
}

// A concept the scheduler has surfaced for resurfacing.
export interface DueConcept {
  id: string
  title: string
  cognitiveState: CognitiveState
  nextReviewAt: string | null
}

// The result of grading a retrieval: the new SM-2 schedule and resulting state.
export interface GradeResult {
  reviewEase: number
  reviewIntervalDays: number
  reviewReps: number
  nextReviewAt: string
  cognitiveState: CognitiveState
}

// --- Socratic Tutor (DET-193) ---
// The challenge angles the Tutor can take. Mirrors the server's TUTOR_ANGLES;
// keep in sync.
export type TutorAngle =
  | 'why'
  | 'counterexample'
  | 'feynman'
  | 'novice'
  | 'premise'
  | 'objection'

// One Tutor challenge: the single question + the angle it took. Ephemeral until
// the user responds — the Tutor never answers, never grades.
export interface TutorChallenge {
  question: string
  angle: TutorAngle
}

// A concept the Tutor should auto-challenge: RETRIEVED but thinly connected.
export interface EligibleConcept {
  id: string
  title: string
  cognitiveState: CognitiveState
}

// --- Understanding Sessions (DET-198) ---
// Why a concept surfaced in a session + the session lifecycle. Mirror the
// server's SessionItemReason / SessionStatus enums; keep in sync.
export type SessionItemReason =
  | 'DUE'
  | 'CONTESTED'
  | 'REDISCOVERY'
  | 'CHALLENGE'
  // An approved Spaced Review prompt drawn from a deeply-read article (DET-310).
  | 'ARTICLE_PROMPT'
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

// One item in a session's queue, in presentation order, with its grade once
// reviewed (null until reached). An item is EITHER a concept item (conceptId
// set) or a review-prompt item (reviewPromptId set) — one retrieval engine
// (DET-310).
export interface SessionItem {
  id: string
  // Set for a concept item; null for a prompt item with no earned concept yet.
  conceptId: string | null
  // Set for an approved-review-prompt item (DET-310); null for a concept item.
  reviewPromptId: string | null
  title: string
  // The concept's current cognitive state (DET-199): lets the session view mark
  // a CONTESTED item, so the contested signal is visible everywhere a concept
  // surfaces (detail, list, and here). Null for a prompt item (no concept).
  cognitiveState: CognitiveState | null
  // Review-prompt fields (DET-310), null for a concept item: the prompt type
  // (e.g. 'definition_recall'), the question to recall, and the user-authored
  // expected answer revealed on demand.
  promptType: string | null
  question: string | null
  expectedAnswer: string | null
  position: number
  reason: SessionItemReason
  reviewedAt: string | null
  recallScore: number | null
}

export interface Session {
  id: string
  startedAt: string
  endedAt: string | null
  targetMinutes: number
  status: SessionStatus
  items: SessionItem[]
}

// What a session would hold right now (DET-310): the start-screen composition.
export interface SessionPreview {
  due: number
  contested: number
  rediscovery: number
  prompts: number
  total: number
}

// A row in the simple session history view.
export interface SessionSummary {
  id: string
  startedAt: string
  endedAt: string | null
  status: SessionStatus
  itemCount: number
}

// --- Anti-Vanity Metrics (DET-200) ---
// A read-only understanding surface. Every field goes up only when the user
// actually understands MORE (retention + synthesis), never by raw activity.
// It DELIBERATELY has no streak / note-count / words / AI-summary / inbox-
// throughput / time-in-app field — the product's thesis is that hoarding is the
// problem, so volume isn't a score. Mirrors the server's UnderstandingMetrics
// (now reconciled to the full DET-200 DoD); keep in sync.

// Compression-quality trend: do re-articulated concepts get sharper (shorter)?
export interface CompressionQualityTrend {
  // Concepts with ≥2 articulations — the only ones a trend can be read from.
  revisitedConcepts: number
  // Fraction (0..1) whose latest articulation is shorter than their first;
  // null when there are no revisited concepts.
  sharperShare: number | null
}

// One weekly bucket of retrieval pass rate (history-over-time).
export interface RetrievalTrendPoint {
  // ISO date string for the start (UTC midnight) of the week bucket.
  weekStart: string
  // Passed / total graded in that week, or null if nothing was graded.
  rate: number | null
}

// One metric paired with its server-provided "why this is a real signal of
// understanding" line, so the web renders a single source of truth.
export interface MetricExplanation {
  key: string
  label: string
  value: number | null
  explanation: string
}

export interface UnderstandingMetrics {
  // Retention: share of graded retrievals passed (0..1), or null if none yet.
  retrievalSuccessRate: number | null
  retrievalsPassed: number
  retrievalsTotal: number
  // Concepts held at a retained depth (RETRIEVED/DEFENDED/INTERNALIZED).
  conceptsRetained: number
  // Synthesis / depth.
  conceptsInternalized: number
  conceptsDefended: number
  // Synthesis events: confirmed connections the user drew between ideas.
  connectionsValidated: number
  reflectionsLogged: number
  // Compression-quality trend: are re-articulated concepts getting sharper?
  compressionQualityTrend: CompressionQualityTrend
  // Transfer signals: concepts reached by a CONFIRMED link from a LATER concept.
  transferSignals: number
  // Defended/Internalized share of live concepts (0..1), or null if none.
  advancedShare: number | null
  // Transitions that moved a concept UP the mastery ladder in the last 30 days.
  forwardTransitions30d: number
  // Decay recovery: dormant concepts the user revived (REACTIVATED transitions).
  decayRecovery: number
  // Retrieval pass rate bucketed by week for the last ~8 weeks (trend, not snapshot).
  retrievalTrend: RetrievalTrendPoint[]
  // Per-metric "why this is a real signal of understanding" lines.
  explanations: MetricExplanation[]
}

// --- Concept Graph (Map) ---
// The persona lifecycle for a Living Concept. A persona is an AI scaffold —
// always visibly marked as such, never blurred with earned knowledge. Mirrors
// the server's LivingConceptStatus enum; keep in sync.
export type LivingConceptStatus = 'DRAFT' | 'USER_VALIDATED' | 'ARCHIVED'

// A single node in the concept map: a concept with the signals the graph view
// needs (cognitive state, activation, persona presence). Mirrors the server's
// GraphNode DTO; keep in sync.
export interface GraphNode {
  id: string
  title: string
  summary: string | null
  cognitiveState: CognitiveState
  status: ConceptStatus
  certainty: Certainty
  currentActivation: number
  hasPersona: boolean
  personaStatus: LivingConceptStatus | null
  createdAt: string
}

// A directed edge between two concepts. SUGGESTED edges are AI/Connector
// proposals awaiting validation; CONFIRMED edges are real, earned connections.
export interface GraphEdge {
  id: string
  sourceConceptId: string
  targetConceptId: string
  relationKind: LinkRelation | null
  relation: string | null
  status: 'SUGGESTED' | 'CONFIRMED'
  proposedBy: QuestionActor
  rationale: string | null
}

// A saved canvas position for a node. `locked` pins it against re-layout.
export interface GraphPosition {
  conceptId: string
  x: number
  y: number
  locked: boolean
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  positions: GraphPosition[]
}

// The bare Link row returned by PATCH /links/:id (validate/reject). It carries no
// source/target concept includes — that's why it isn't a ConceptLinkEnd.
export interface LinkRow {
  id: string
  status: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED'
  relationKind: LinkRelation | null
  relation: string | null
}

// A Living Concept: an AI-authored persona that gives a concept a voice and a
// core metaphor. It is SCAFFOLD, never earned knowledge — the UI marks it as a
// draft until the user explicitly validates it.
export interface LivingConcept {
  id: string
  conceptId: string
  personaName: string
  personaSummary: string
  voice: string | null
  coreMetaphor: string | null
  metaphorBreaks: string | null
  status: LivingConceptStatus
  createdBy: Generator
  createdAt: string
  updatedAt: string
}

// --- Knowledge Organization: Tracks (DET-235/237) ---
// A Track is the goal-directed layer — the product's primary entry point. Mirrors
// the server's TrackType/TrackStatus/etc. enums; keep in sync.
export type TrackType =
  | 'LEARNING'
  | 'RESEARCH'
  | 'PROJECT'
  | 'CAREER'
  | 'COURSE'
  | 'PAPER_REVIEW'
  | 'PRODUCT_BUILDING'
export type TrackStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED'
export type ImportanceLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RequiredDepth = 'RECOGNIZE' | 'EXPLAIN' | 'APPLY' | 'TEACH'
export type TrackConceptStatus =
  | 'CANDIDATE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'SKIPPED'

export interface Track {
  id: string
  workspaceId: string
  name: string
  description: string | null
  type: TrackType
  goal: string | null
  status: TrackStatus
  createdAt: string
  updatedAt: string
}

// Derived per-track progress (DET-235): requiredDepth read against the concept's
// live CognitiveState. Never a stored mastery value.
export interface TrackConceptProgress {
  requiredDepth: RequiredDepth
  state: CognitiveState
  met: boolean
  ratio: number
  needsAttention: boolean
}

// A concept's membership in a track, joined with the concept fields the UI needs
// plus derived progress.
export interface TrackConceptRow {
  trackId: string
  conceptId: string
  orderIndex: number | null
  importance: ImportanceLevel
  requiredDepth: RequiredDepth
  status: TrackConceptStatus
  createdBy: Generator
  createdAt: string
  concept: {
    id: string
    title: string
    cognitiveState: CognitiveState
    status: ConceptStatus
  }
  progress: TrackConceptProgress
}

// --- Knowledge Organization: Domains (DET-234/238) ---
// A Domain is a semantic region (not a folder); a concept can be in several.
export interface Domain {
  id: string
  workspaceId: string
  name: string
  description: string | null
  parentDomainId: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

// A concept's membership in a domain, joined with the domain. Provenance
// (createdBy/userValidated) drives the suggested-vs-validated visual grammar.
export interface ConceptDomainRow {
  conceptId: string
  domainId: string
  confidence: number | null
  createdBy: Generator
  userValidated: boolean
  createdAt: string
  domain: Domain
}

// --- Knowledge Organization: Graph scopes & saved views (DET-236/239) ---
// Only the scopes the UI can actually request (DET-303): WORKSPACE (the default
// map), TRACK and DOMAIN (the scope selector), and CONCEPT_NEIGHBORHOOD (entered
// by focusing a node). The server-side `GraphScope` Prisma enum still defines
// ARTICLE / MISCONCEPTION / REVIEW for the data model, but they have no UI, so the
// client contract intentionally omits them rather than offer phantom surface area.
export type GraphScope =
  | 'TRACK'
  | 'DOMAIN'
  | 'WORKSPACE'
  | 'CONCEPT_NEIGHBORHOOD'

// Parameters for a scoped graph read (DET-236). `scope` decides which target id
// is required; the canvas just receives a different {nodes,edges} subset.
export interface GraphScopeParams {
  scope: GraphScope
  trackId?: string
  domainId?: string
  sourceConceptId?: string
  centerConceptId?: string
  hops?: number
}

export interface GraphView {
  id: string
  workspaceId: string
  name: string
  scope: GraphScope
  sourceConceptId: string | null
  trackId: string | null
  domainId: string | null
  centerConceptId: string | null
  filters: Record<string, unknown>
  layout: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Source-Preserving Article Transformer (DET-247…259)
//
// MIRROR of the FROZEN contract in server/src/transformer/transformer.types.ts
// (committed in 644b5db). The SourcePreservingArticle/FidelityReport/CoverageReport
// types below are byte-for-byte the same shape as that file — do NOT diverge.
// The remaining DTO types mirror the M1 controller/service response shapes
// (transformer.service.ts) + the prisma status enums. Keep in sync.
// ============================================================================

// --- Pipeline + article status enums (prisma) ---
export type TransformerSourceType = 'TEXT' | 'URL' | 'PDF'
export type TransformerSourceStatus =
  | 'INGESTED'
  | 'EXTRACTING'
  | 'EXTRACTED'
  | 'SEGMENTED'
  | 'CLASSIFYING'
  | 'READY'
  | 'EXTRACTION_FAILED'
  | 'FAILED'
export type TransformerBlockType =
  | 'HEADING'
  | 'PARAGRAPH'
  | 'LIST'
  | 'QUOTE'
  | 'TABLE'
  | 'CODE'
  | 'CAPTION'
  | 'UNKNOWN'
export type TransformerBlockClass =
  | 'MAIN_ARGUMENT'
  | 'DEFINITION'
  | 'EXAMPLE'
  | 'EVIDENCE'
  | 'METHOD'
  | 'BACKGROUND'
  | 'SIDEBAR'
  | 'CITATION'
  | 'NAVIGATION_NOISE'
  | 'ADVERTISEMENT'
  | 'FOOTER'
  | 'DUPLICATE'
  | 'UNCERTAIN'
export type TransformedArticleStatus =
  | 'QUEUED'
  | 'MODELING'
  | 'PLANNING'
  | 'GENERATING'
  | 'CHECKING'
  | 'FINAL'
  | 'BLOCKED'
  | 'FAILED'

// --- FROZEN shared JSON contract (mirrors transformer.types.ts EXACTLY) ---
export type TransformationType =
  | 'verbatim'
  | 'grammar_cleanup'
  | 'light_reword'
  | 'paragraph_split'
  | 'paragraph_merge'
  | 'formatting_only'

export type FidelityRisk = 'low' | 'medium' | 'high'

export type Severity = 'low' | 'medium' | 'high'

export type HeadingSource = 'original' | 'light_reword' | 'inferred_from_source'

export interface ArticleParagraph {
  id: string
  text: string
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
}

export interface ArticleSection {
  id: string
  heading: string
  headingSource: HeadingSource
  sourceBlockIds: string[]
  paragraphs: ArticleParagraph[]
}

export interface SourcePreservingArticle {
  mode: 'source_preserving_article'
  title: { text: string; source: HeadingSource }
  subtitle?: { text: string; source: HeadingSource; sourceBlockIds: string[] }
  /** Source summary assembled only from source blocks. */
  abstract: ArticleParagraph[]
  sections: ArticleSection[]
  keyTerms: { term: string; sourceBlockIds: string[] }[]
  sourceExamples: { text: string; sourceBlockIds: string[] }[]
  caveats: { text: string; sourceBlockIds: string[] }[]
  /** Source outline reference. */
  originalStructure: { blockId: string; blockType: string; preview: string }[]
}

export interface FidelityFinding {
  severity: Severity
  description: string
  articleRef?: string
  sourceBlockIds?: string[]
}

export interface FidelityReport {
  fidelityScore: number
  approved: boolean
  addedInformation: FidelityFinding[]
  lostInformation: FidelityFinding[]
  meaningChanges: FidelityFinding[]
  unsupportedHeadings: FidelityFinding[]
  missingCaveats: FidelityFinding[]
  unsupportedExamples: FidelityFinding[]
  // DET-281: structure-driven emphasis shifts + structural fidelity findings.
  // Optional in the mirror because old stored reports predate these groups and
  // the renderer must tolerate absence (defaults to [] on the server).
  emphasisChanges?: FidelityFinding[]
  structuralFindings?: FidelityFinding[]
}

export interface CoverageReport {
  totalBlocks: number
  coveragePercent: number
  representedBlockIds: string[]
  removedBlocks: { blockId: string; reason: string }[]
  uncertainBlockIds: string[]
  unrepresentedBlockIds: string[]
  paragraphMap: {
    paragraphId: string
    sourceBlockIds: string[]
    transformationType: TransformationType
    fidelityRisk: FidelityRisk
  }[]
  // Audited-reorder summary (DET-275). Additive + back-compat: absent on coverage
  // reports produced before W10. `audited` = declared audit entries; `unaudited` =
  // detected section moves not covered by the audit (the checker blocks those).
  reorderAudit?: { audited: number; unaudited: number }
}

// --- Article JSON v2 contract (DET-277) ---
// MIRROR of the v2/v3 contract in server/src/transformer/transformer.types.ts —
// the SERVER is the single adaptation boundary (`getArticle` adapts legacy v1 →
// v2), so the web ONLY ever receives a structured article. v3 (DET-350) is an
// additive superset of v2 (generated callouts, comparison tables, source notes),
// so a v3 article is shape-compatible with these types. Do NOT diverge.

export type ArticleSchemaVersion = 'v2' | 'v3'

export type HeadingSourceV2 = 'original' | 'cleanedOriginal' | 'inferred'

export type SectionRole =
  | 'definition'
  | 'claim'
  | 'evidence'
  | 'example'
  | 'step'
  | 'caveat'
  | 'background'
  | 'referenceEntry'
  | 'chronology'

export type ArticleBlockType =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'pullQuote'
  | 'table'
  | 'code'
  | 'figureAnchor'
  | 'callout'

export interface ArticleBlockBase {
  id: string
  type: ArticleBlockType
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
}

export interface ArticleParagraphBlock extends ArticleBlockBase {
  type: 'paragraph'
  text: string
}

export interface ArticleListBlock extends ArticleBlockBase {
  type: 'list'
  ordered: boolean
  items: string[]
}

export interface ArticleQuoteBlock extends ArticleBlockBase {
  type: 'quote'
  text: string
  attribution?: string
}

export interface ArticlePullQuoteBlock extends ArticleBlockBase {
  type: 'pullQuote'
  text: string
}

export interface ArticleTableBlock extends ArticleBlockBase {
  type: 'table'
  caption?: string
  header?: string[]
  rows: string[][]
}

export interface ArticleCodeBlock extends ArticleBlockBase {
  type: 'code'
  text: string
  language?: string
}

export interface ArticleFigureAnchorBlock extends ArticleBlockBase {
  type: 'figureAnchor'
  suggestionId?: string
  caption?: string
}

export interface ArticleCalloutBlock extends ArticleBlockBase {
  type: 'callout'
  calloutType?: string
  title?: string
  text: string
}

export type ArticleBlock =
  | ArticleParagraphBlock
  | ArticleListBlock
  | ArticleQuoteBlock
  | ArticlePullQuoteBlock
  | ArticleTableBlock
  | ArticleCodeBlock
  | ArticleFigureAnchorBlock
  | ArticleCalloutBlock

export interface ArticleSectionV2 {
  id: string
  heading: string
  headingSource: HeadingSourceV2
  headingSourceBlockIds?: string[]
  sectionRole?: SectionRole
  sourceBlockIds: string[]
  blocks: ArticleBlock[]
  subsections?: ArticleSectionV2[]
}

export interface TocEntry {
  sectionId: string
  heading: string
  headingSource: HeadingSourceV2
  children?: {
    sectionId: string
    heading: string
    headingSource: HeadingSourceV2
  }[]
}

export interface ArticleReadingAids {
  toc: TocEntry[]
  readingTime: { wordCount: number; minutes: number }
  highlights?: { text: string; sourceBlockIds: string[] }[]
}

export interface ArticleCallout {
  id: string
  kind: 'keyTerm' | 'example' | 'caveat'
  term?: string
  text: string
  sourceBlockIds: string[]
  placementReason: string
}

export interface ArticleCalloutPlacement {
  bySection: Record<string, ArticleCallout[]>
  unplaced: ArticleCallout[]
  // v3 (DET-350): source-grounded generated callouts.
  generated?: ArticleGeneratedCallout[]
}

// --- v3 source-grounded extras (DET-350) ---
export type ArticleCalloutType =
  | 'definition'
  | 'key_idea'
  | 'source_analogy'
  | 'caveat'
  | 'example'
  | 'warning'
  | 'remember'
  | 'compare'

export interface ArticleGeneratedCallout {
  id: string
  type: ArticleCalloutType
  title: string
  body: string
  sourceBlockIds: string[]
  relatedSectionIds: string[]
  fidelityRisk: FidelityRisk
}

export interface ArticleTableCell {
  text: string
  sourceBlockIds?: string[]
}

export interface ArticleComparisonTableRow {
  cells: ArticleTableCell[]
  sourceBlockIds: string[]
}

export interface ArticleComparisonTable {
  id: string
  title: string
  columns: string[]
  rows: ArticleComparisonTableRow[]
  sourceBlockIds: string[]
  relatedSectionIds: string[]
  fidelityRisk: FidelityRisk
}

export interface ArticleSourceNoteItem {
  text: string
  sourceBlockIds: string[]
  url?: string
}

export interface ArticleSourceNotes {
  references: ArticleSourceNoteItem[]
  bibliography: ArticleSourceNoteItem[]
  externalLinks: ArticleSourceNoteItem[]
  removedNavigation: ArticleSourceNoteItem[]
  lowImportance: ArticleSourceNoteItem[]
}

export type ArticleShape =
  | 'explainer'
  | 'argument'
  | 'procedure'
  | 'reference'
  | 'report'
  | 'narrative'
  | 'hybrid'

export interface ArticleReorderingAudit {
  sourceBlockId: string
  fromIndex: number
  toIndex: number
  movedWithClusterIds?: string[]
  reason: string
  risk: FidelityRisk
}

export interface ArticleJsonV2 {
  schemaVersion: ArticleSchemaVersion
  mode: 'source_preserving_article'
  title: { text: string; source: HeadingSourceV2 }
  subtitle?: { text: string; source: HeadingSourceV2; sourceBlockIds: string[] }
  abstract: ArticleParagraph[]
  sections: ArticleSectionV2[]
  keyTerms: { term: string; sourceBlockIds: string[] }[]
  sourceExamples: { text: string; sourceBlockIds: string[] }[]
  caveats: { text: string; sourceBlockIds: string[] }[]
  originalStructure: { blockId: string; blockType: string; preview: string }[]
  readingAids?: ArticleReadingAids
  calloutPlacements?: ArticleCalloutPlacement
  shape?: ArticleShape
  reorderings?: ArticleReorderingAudit[]
  // v3 additive fields (DET-350).
  tables?: ArticleComparisonTable[]
  sourceNotes?: ArticleSourceNotes
}

// --- Source DTOs (mirror transformer.service.ts) ---
// Extraction/segmentation metadata persisted on the source. `truncated`/`degraded`
// drive the warning chips the UI must surface (spec §Pipeline 2).
export interface TransformerSourceMetadata {
  title?: string
  author?: string
  publishedDate?: string
  pageCount?: number
  url?: string
  fileName?: string
  truncated?: boolean
  degraded?: boolean
  [key: string]: unknown
}

export interface TransformerSourceListItem {
  id: string
  type: TransformerSourceType
  status: TransformerSourceStatus
  title: string | null
  url: string | null
  fileName: string | null
  createdAt: string
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
}

export interface TransformerSourceDetail {
  id: string
  type: TransformerSourceType
  status: TransformerSourceStatus
  title: string | null
  url: string | null
  fileName: string | null
  metadata: TransformerSourceMetadata | null
  extractionError: string | null
  blocksVersion: number
  blockCount: number
  createdAt: string
  updatedAt: string
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
}

// One block in the debug-inspectable blocks view (DET-250). Also indexed by id by
// the article source inspector (DET-257) to resolve each paragraph's source.
export interface TransformerBlockView {
  id: string
  orderIndex: number
  blockType: string
  text: string
  pageNumber: number | null
  charStart: number | null
  charEnd: number | null
  classification: string | null
  classificationStatus: string
  removable: boolean
  noiseReason: string | null
}

// --- Article + optional layers (Wave B; mirrors GET /articles/:id) ---
// AI-assisted illustration suggestion (DET-259). Suggestions only — never images.
export type IllustrationApproval = 'pending' | 'approved' | 'rejected'
export type IllustrationType =
  | 'editorial_cover'
  | 'decorative_section'
  | 'source_based_diagram'

export interface IllustrationImageMeta {
  width: number
  height: number
  provider: string
  model: string
  generatedAt: string
}

export interface IllustrationSuggestion {
  id: string
  illustrationType: IllustrationType
  purpose: string
  visualDescription: string
  caption: string
  fidelityRisk: FidelityRisk
  reason: string
  sourceBlockIds: string[]
  approval: IllustrationApproval
  // DET-261: present once the approved suggestion has been rendered into an
  // image. Absent/null = not yet rendered. The PNG bytes are fetched separately
  // (authenticated blob), never embedded in this JSON.
  image?: IllustrationImageMeta | null
}

export interface IllustrationPlan {
  suggestions: IllustrationSuggestion[]
}

// AI-generated WORLD KNOWLEDGE enrichment for the Compendium render — encyclopedia
// extras (IPA, part of speech, etymology, classification, key facts) the article
// schema doesn't model. NOT grounded in the user's source: the web layer renders
// every field with a visible "✦ AI · not from your source" marker. All optional.
export interface ArticleEnrichment {
  pronunciation?: string
  partOfSpeech?: string
  etymology?: string
  classification?: string
  keyFacts?: { label: string; value: string }[]
}

// Generative EDITORIAL LAYOUT — the presentation furniture (kicker, standfirst,
// sub-heads, pull-quote choice, stat band, marginal notes, figure placements) that
// lets a thin source render as a full Compendium entry. Mirrors the server
// `EditorialLayout` (transformer.types.ts). Additive: it never carries article
// substance and only references existing section/block/suggestion ids. Any field
// with `grounded: false` is rendered with the "✦ AI · not from your source" marker.
// All optional; an article with no editorial lane simply has `editorialLayout: null`.
export interface EditorialCaption {
  takeaway: string
  detail: string
}
export interface EditorialFigurePlacement {
  suggestionId: string
  sectionId: string
  /** Place AFTER this many opening paragraphs of the section (never front-loaded). */
  afterParagraphIndex: number
  /** 'span' = full-width section hero; 'column' = in-column secondary `Fig.`. */
  size: 'span' | 'column'
  figureNumber: number
  caption?: EditorialCaption
}
export interface EditorialMarginalNote {
  sectionId: string
  afterParagraphIndex: number
  title: string
  text: string
  grounded: boolean
}
export interface EditorialSubhead {
  sectionId: string
  afterParagraphIndex: number
  text: string
}
export interface EditorialLayout {
  kicker?: { text: string; grounded: boolean }
  standfirst?: { text: string; grounded: boolean }
  subheads?: EditorialSubhead[]
  pullQuote?: {
    sectionId: string
    blockId?: string
    text: string
    grounded: boolean
  }
  statBand?: { grounded: boolean; stats: { figure: string; label: string }[] }
  marginalNotes?: EditorialMarginalNote[]
  figurePlacements?: EditorialFigurePlacement[]
}

// AI-assisted learning layer (DET-258). Stored ONLY here, never in articleJson.
export type LearningValidationStatus = 'pending' | 'validated' | 'dismissed'

export interface LearningConcept {
  id: string
  label: string
  definition: string
  sourceBlockIds: string[]
  validationStatus: LearningValidationStatus
}

export interface LearningRetrievalPrompt {
  id: string
  prompt: string
  sourceBlockIds: string[]
}

// A per-section concept-extraction CANDIDATE (DET-283). A PROPOSAL — never an
// earned/library Concept: aiAssisted is always true and validationStatus starts
// 'pending'. Scoped to the v2 section it was extracted from (sectionId) and
// grounded in that section's real source blocks (sourceBlockIds). blockType /
// sectionRole are code-stamped metadata. Mirrors the server LearningConceptCandidate
// byte-for-byte.
export interface LearningConceptCandidate {
  id: string
  sectionId: string
  label: string
  definition: string
  sourceBlockIds: string[]
  blockType?: string
  sectionRole?: string
  aiAssisted: true
  validationStatus: LearningValidationStatus
  /** The INBOX "to learn" Concept created when the user validated this
   *  candidate (DET-283). Present ⇒ validation already promoted it. */
  conceptId?: string
}

// The pedagogical category of a retrieval prompt (DET-353). Mirrors the server
// RetrievalPromptType enum byte-for-byte.
export type RetrievalPromptType =
  | 'definition'
  | 'mechanism'
  | 'distinction'
  | 'sequence'
  | 'analogy'
  | 'misconception_repair'
  | 'transfer'

// A richer active-recall prompt CANDIDATE (DET-353). Distinct from the DET-258
// LearningRetrievalPrompt above: it carries the expected-answer source blocks, a
// pedagogical type + difficulty, links to concept candidates, and a lifecycle
// status. AI-suggested at generation; nothing is scheduled as a permanent review
// card until the learner validates/answers it (status flips downstream).
export interface RetrievalPromptCandidate {
  id: string
  question: string
  expectedAnswerSourceBlockIds: string[]
  relatedConceptCandidateIds: string[]
  promptType: RetrievalPromptType
  difficulty: 'easy' | 'medium' | 'hard'
  status: 'ai_suggested' | 'user_validated' | 'rejected'
}

// A misconception candidate (DET-353): a likely wrong belief + a source-faithful
// correction. sourceBlockIds MAY be empty — an ungrounded one is kept but stays
// clearly AI-suggested. confidence is in [0,1].
export interface MisconceptionCandidate {
  id: string
  misconception: string
  correction: string
  sourceBlockIds: string[]
  relatedConceptCandidateIds: string[]
  confidence: number
  status: 'ai_suggested' | 'validated' | 'rejected'
}

export interface LearningLayer {
  concepts: LearningConcept[]
  retrievalPrompts: LearningRetrievalPrompt[]
  // Additive (DET-283): old learning-layer rows predate this and omit it.
  conceptCandidates?: LearningConceptCandidate[]
  // Additive (DET-353): AI-suggested active-recall prompts + misconception
  // candidates. Old learning-layer rows predate these and omit them.
  retrievalPromptCandidates?: RetrievalPromptCandidate[]
  misconceptions?: MisconceptionCandidate[]
}

// GET /transformer/articles/:id — the article + fidelity + coverage + status.
export interface TransformedArticle {
  id: string
  sourceId: string
  status: TransformedArticleStatus
  // Always v2 — the server adapts legacy v1 at the read boundary (DET-277).
  articleJson: ArticleJsonV2 | null
  fidelityReport: FidelityReport | null
  fidelityScore: number | null
  coverageReport: CoverageReport | null
  illustrationPlan: IllustrationPlan | null
  learningLayer: LearningLayer | null
  // AI world-knowledge extras for the Compendium render (rendered with a visible
  // "not from your source" marker). Null on articles generated before this lane.
  enrichment: ArticleEnrichment | null
  // Generative editorial layout — presentation furniture for the Compendium render
  // (kicker, standfirst, sub-heads, pull-quote, stat band, marginal notes, figure
  // placements). Null on articles generated before this lane.
  editorialLayout: EditorialLayout | null
  error: string | null
}

// Mirrors the server DTO allowlist (WAITLIST_SOURCES) — add new values there first.
export type WaitlistSource = 'landing-hero' | 'landing-footer'

export const api = {
  // --- Waitlist (DET-270): public, no auth — a visitor's request() simply has
  // no token. Idempotent server-side on duplicate email (no enumeration).
  joinWaitlist: (input: { email: string; source?: WaitlistSource }) =>
    request<{ ok: boolean }>('/waitlist', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  register: (input: { email: string; password: string; name?: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  login: (input: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  me: () => request<Profile>('/auth/me'),

  // --- Workspaces (DET-232/233): the tenancy container that owns concepts ---
  listWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (input: { name: string; description?: string }) =>
    request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorkspace: (
    id: string,
    input: { name?: string; description?: string },
  ) =>
    request<Workspace>(`/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteWorkspace: (id: string) =>
    request<void>(`/workspaces/${id}`, { method: 'DELETE' }),

  // --- Capture inbox (DET-187) ---
  // Track-first onboarding (DET-240): an optional `trackId` routes the capture
  // into a track; on promotion the earned concept auto-enrolls as an AI candidate.
  listInbox: () => request<InboxItem[]>('/inbox'),
  captureText: (input: { text: string; title?: string; trackId?: string }) =>
    request<InboxItem>('/inbox/text', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  captureUrl: (input: { url: string; trackId?: string }) =>
    request<InboxItem>('/inbox/url', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  capturePdf: (file: File, trackId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (trackId) form.append('trackId', trackId)
    return upload<InboxItem>('/inbox/pdf', form)
  },
  discardInboxItem: (id: string) =>
    request<void>(`/inbox/${id}`, { method: 'DELETE' }),
  // Snooze a captured item out of the inbox until `until` (ISO datetime, DET-241).
  snoozeInboxItem: (id: string, until: string) =>
    request<void>(`/inbox/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ until }),
    }),
  // Forge several captured fragments into one merged inbox item (DET-241).
  // Consumes the originals; returns the new merged item.
  forgeInbox: (ids: string[]) =>
    request<InboxItem>('/inbox/forge', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  getInboxItem: (id: string) => request<InboxItemDetail>(`/inbox/${id}`),

  // --- Semantic Chunking + Concept Library (DET-211) ---
  getInboxChunks: (id: string) =>
    request<ConceptChunk[]>(`/inbox/${id}/chunks`),
  // The persisted library: classified chunks + candidate concepts (scaffold).
  getConceptLibrary: (id: string) =>
    request<ConceptLibrary>(`/inbox/${id}/concept-library`),
  regenerateConceptLibrary: (id: string) =>
    request<ConceptLibrary>(`/inbox/${id}/concept-library/regenerate`, {
      method: 'POST',
    }),
  dismissCandidate: (id: string) =>
    request<void>(`/concept-candidates/${id}/dismiss`, { method: 'POST' }),
  // Undo a dismissal (DET-309): flips the candidate back into the active library.
  restoreCandidate: (id: string) =>
    request<void>(`/concept-candidates/${id}/restore`, { method: 'POST' }),

  // --- Intake interrogation (DET-188) ---
  generateInterrogation: (conceptId: string) =>
    request<IntakeQuestion[]>(`/intake/${conceptId}/questions`, {
      method: 'POST',
    }),
  getInterrogation: (conceptId: string) =>
    request<IntakeQuestion[]>(`/intake/${conceptId}`),
  saveInterrogationAnswers: (
    conceptId: string,
    answers: { questionId: string; answer: string }[],
  ) =>
    request<IntakeQuestion[]>(`/intake/${conceptId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  // --- Proof-of-Learning Gate (DET-189) ---
  // An optional candidateId (DET-211 handoff) surfaces that candidate's label +
  // definition as DISPLAY-ONLY reference context — never prefilled (DET-190).
  getPromotion: (conceptId: string, candidateId?: string) =>
    request<PromotionState>(
      `/promotion/${conceptId}${
        candidateId ? `?candidateId=${encodeURIComponent(candidateId)}` : ''
      }`,
    ),
  saveArticulation: (conceptId: string, body: string) =>
    request<PromotionState>(`/promotion/${conceptId}/articulation`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  setFriction: (conceptId: string, level: FrictionLevel) =>
    request<PromotionState>(`/promotion/${conceptId}/friction`, {
      method: 'PUT',
      body: JSON.stringify({ level }),
    }),
  getConnectionSuggestions: (conceptId: string) =>
    request<SuggestedConnection[]>(`/promotion/${conceptId}/connections`),
  markConnectionsReviewed: (conceptId: string) =>
    request<PromotionState>(`/promotion/${conceptId}/connections/reviewed`, {
      method: 'POST',
    }),
  generateRetrieval: (conceptId: string) =>
    request<{ question: string }>(`/promotion/${conceptId}/retrieval`, {
      method: 'POST',
    }),
  answerRetrieval: (conceptId: string, response: string) =>
    request<RetrievalGrade>(`/promotion/${conceptId}/retrieval/answer`, {
      method: 'POST',
      body: JSON.stringify({ response }),
    }),
  commitPromotion: (conceptId: string, input: CommitPromotionInput) =>
    request<ConceptDetail>(`/promotion/${conceptId}/commit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  abandonPromotion: (conceptId: string) =>
    request<void>(`/promotion/${conceptId}`, { method: 'DELETE' }),

  // --- Reference Q&A (DET-208) ---
  // An optional scope (DET-211) grounds the answer in a single chunk's or
  // candidate's source blocks instead of the whole document.
  askSourceQuestion: (
    conceptId: string,
    questionText: string,
    scope?: { chunkId?: string; candidateId?: string },
  ) =>
    request<SourceQuestion>(`/source-qa/${conceptId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ questionText, ...scope }),
    }),
  listSourceQuestions: (conceptId: string) =>
    request<SourceQuestion[]>(`/source-qa/${conceptId}`),
  deleteSourceQuestion: (id: string) =>
    request<void>(`/source-qa/entry/${id}`, { method: 'DELETE' }),

  // --- Concepts (the earned, permanent layer) ---
  listConcepts: () => request<Concept[]>('/concepts'),
  getConcept: (id: string) => request<ConceptDetail>(`/concepts/${id}`),
  // Memory decay (DET-195): revive a faded concept — restores full activation
  // and brings a DORMANT one back into a knowledge state. Returns its new state.
  reviveConcept: (id: string) =>
    request<CognitiveState>(`/concepts/${id}/revive`, { method: 'POST' }),
  // Provenance & Uncertainty (DET-199): set the user's certainty on a concept.
  // Uncertainty is expressible, never flattened to implied certainty.
  setCertainty: (id: string, certainty: Certainty) =>
    request<Concept>(`/concepts/${id}/certainty`, {
      method: 'POST',
      body: JSON.stringify({ certainty }),
    }),

  // --- Retrieval Engine (DET-192) ---
  getDueRetrievals: () => request<DueConcept[]>('/retrieval-events/due'),
  getRetrievalCards: (conceptId: string) =>
    request<RetrievalCard[]>(`/retrieval-events/cards/${conceptId}`),
  gradeRetrieval: (
    conceptId: string,
    input: {
      score: number
      question?: string
      response?: string
    },
  ) =>
    request<GradeResult>('/retrieval-events/grade', {
      method: 'POST',
      body: JSON.stringify({ conceptId, ...input }),
    }),

  // --- Socratic Tutor (DET-193) ---
  challengeTutor: (conceptId: string, angle?: TutorAngle) =>
    request<TutorChallenge>(`/tutor/${conceptId}/challenge`, {
      method: 'POST',
      body: JSON.stringify(angle ? { angle } : {}),
    }),
  respondToTutor: (
    conceptId: string,
    input: { question: string; response: string; defended: boolean },
  ) =>
    request<{
      articulation: ConceptArticulation
      cognitiveState: CognitiveState
    }>(`/tutor/${conceptId}/respond`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getTutorEligible: () => request<EligibleConcept[]>('/tutor/eligible'),

  // --- Understanding Sessions (DET-198) ---
  startSession: (targetMinutes?: number) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(targetMinutes != null ? { targetMinutes } : {}),
    }),
  getActiveSession: () => request<Session | null>('/sessions/active'),
  // The start-screen composition (DET-310): what's due/contested/etc. right now.
  getSessionPreview: () => request<SessionPreview>('/sessions/preview'),
  // Review one item — a concept (conceptId) or an approved review prompt
  // (reviewPromptId). One queue, one review call (DET-310). Returns the concept
  // grade result, or a minimal ack for a prompt review.
  reviewSessionItem: (
    sessionId: string,
    target: { conceptId: string } | { reviewPromptId: string },
    score: number,
  ) =>
    request<GradeResult | { rescheduled: true }>(
      `/sessions/${sessionId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ ...target, score }),
      },
    ),
  endSession: (sessionId: string) =>
    request<Session>(`/sessions/${sessionId}/end`, { method: 'POST' }),
  getSessionHistory: () => request<SessionSummary[]>('/sessions/history'),

  // --- Reflection (DET-196) ---
  submitReflections: (
    sessionId: string,
    items: { conceptId: string; kind: ReflectionKind; note?: string }[],
  ) =>
    request<Reflection[]>('/reflections', {
      method: 'POST',
      body: JSON.stringify({ sessionId, items }),
    }),
  getConceptReflections: (conceptId: string) =>
    request<Reflection[]>(`/reflections?conceptId=${conceptId}`),

  // --- Anti-Vanity Metrics (DET-200) ---
  getMetrics: () => request<UnderstandingMetrics>('/metrics'),

  // --- Concept Graph (Map) ---
  getGraph: () => request<GraphData>('/graph'),
  // Persist node positions after a drag. (`locked` node-pinning is deferred — see
  // DET-226 — so the write path only carries coordinates.)
  saveGraphPositions: (
    positions: { conceptId: string; x: number; y: number }[],
  ) =>
    request<{ saved: number }>('/graph/positions', {
      method: 'PUT',
      body: JSON.stringify({ positions }),
    }),

  // --- Living Concepts (AI persona scaffold) ---
  createLivingConcept: (conceptId: string) =>
    request<LivingConcept>('/living-concepts', {
      method: 'POST',
      body: JSON.stringify({ conceptId }),
    }),
  getLivingConcept: (conceptId: string) =>
    request<LivingConcept | null>(`/living-concepts/concept/${conceptId}`),
  updateLivingConcept: (
    id: string,
    input: Partial<
      Pick<
        LivingConcept,
        | 'personaName'
        | 'personaSummary'
        | 'voice'
        | 'coreMetaphor'
        | 'metaphorBreaks'
        | 'status'
      >
    >,
  ) =>
    request<LivingConcept>(`/living-concepts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  // --- Links (validate / reject a suggested connection from the map) ---
  // PATCH /links/:id returns the bare updated Link (no source/target concept
  // includes), so the response is typed as that accurate subset, not ConceptLinkEnd.
  confirmLink: (id: string) =>
    request<LinkRow>(`/links/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CONFIRMED' }),
    }),
  rejectLink: (id: string) =>
    request<LinkRow>(`/links/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'REJECTED' }),
    }),

  // --- Tracks (DET-235/237): the goal-directed layer ---
  listTracks: (status?: TrackStatus) =>
    request<Track[]>(`/tracks${status ? `?status=${status}` : ''}`),
  createTrack: (input: {
    name: string
    type: TrackType
    description?: string
    goal?: string
  }) =>
    request<Track>('/tracks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTrack: (
    id: string,
    input: {
      name?: string
      description?: string
      type?: TrackType
      goal?: string
      status?: TrackStatus
    },
  ) =>
    request<Track>(`/tracks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTrack: (id: string) =>
    request<void>(`/tracks/${id}`, { method: 'DELETE' }),
  listTrackConcepts: (trackId: string) =>
    request<TrackConceptRow[]>(`/tracks/${trackId}/concepts`),
  addTrackConcept: (
    trackId: string,
    input: {
      conceptId: string
      importance?: ImportanceLevel
      requiredDepth?: RequiredDepth
      orderIndex?: number
    },
  ) =>
    request<TrackConceptRow>(`/tracks/${trackId}/concepts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTrackConcept: (
    trackId: string,
    conceptId: string,
    input: {
      status?: TrackConceptStatus
      importance?: ImportanceLevel
      requiredDepth?: RequiredDepth
      orderIndex?: number
    },
  ) =>
    request<TrackConceptRow>(`/tracks/${trackId}/concepts/${conceptId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeTrackConcept: (trackId: string, conceptId: string) =>
    request<void>(`/tracks/${trackId}/concepts/${conceptId}`, {
      method: 'DELETE',
    }),

  // --- Domains (DET-234/238): semantic regions ---
  listDomains: () => request<Domain[]>('/domains'),
  createDomain: (input: {
    name: string
    description?: string
    parentDomainId?: string
    color?: string
  }) =>
    request<Domain>('/domains', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDomain: (
    id: string,
    input: {
      name?: string
      description?: string
      parentDomainId?: string | null
      color?: string
    },
  ) =>
    request<Domain>(`/domains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteDomain: (id: string) =>
    request<void>(`/domains/${id}`, { method: 'DELETE' }),
  // Concept ⇄ domain membership. Tag/untag, validate an AI suggestion, or ask the
  // AI to suggest domains for a concept (suggestions arrive userValidated:false).
  listConceptDomains: (conceptId: string) =>
    request<ConceptDomainRow[]>(`/concepts/${conceptId}/domains`),
  tagConceptDomain: (
    conceptId: string,
    input: { domainId: string; confidence?: number },
  ) =>
    request<unknown>(`/concepts/${conceptId}/domains`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  suggestConceptDomains: (conceptId: string) =>
    request<unknown[]>(`/concepts/${conceptId}/domains/suggest`, {
      method: 'POST',
    }),
  validateConceptDomain: (conceptId: string, domainId: string) =>
    request<unknown>(`/concepts/${conceptId}/domains/${domainId}/validate`, {
      method: 'POST',
    }),
  untagConceptDomain: (conceptId: string, domainId: string) =>
    request<void>(`/concepts/${conceptId}/domains/${domainId}`, {
      method: 'DELETE',
    }),

  // --- Scoped graph + saved views (DET-236/239) ---
  // GET /graph with optional scope params; no params = the WORKSPACE map (today's
  // behavior). The canvas is unchanged — it just receives a different subset.
  getScopedGraph: (params?: GraphScopeParams) => {
    const query = new URLSearchParams()
    if (params && params.scope !== 'WORKSPACE') {
      query.set('scope', params.scope)
      if (params.trackId) query.set('trackId', params.trackId)
      if (params.domainId) query.set('domainId', params.domainId)
      if (params.sourceConceptId)
        query.set('sourceConceptId', params.sourceConceptId)
      if (params.centerConceptId)
        query.set('centerConceptId', params.centerConceptId)
      if (params.hops != null) query.set('hops', String(params.hops))
    }
    const qs = query.toString()
    return request<GraphData>(`/graph${qs ? `?${qs}` : ''}`)
  },
  listGraphViews: () => request<GraphView[]>('/graph-views'),
  createGraphView: (input: {
    name: string
    scope: GraphScope
    trackId?: string
    domainId?: string
    sourceConceptId?: string
    centerConceptId?: string
    filters?: Record<string, unknown>
    layout?: Record<string, unknown>
  }) =>
    request<GraphView>('/graph-views', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  resolveGraphView: (id: string) =>
    request<GraphData>(`/graph-views/${id}/resolve`),
  deleteGraphView: (id: string) =>
    request<void>(`/graph-views/${id}`, { method: 'DELETE' }),

  // --- Source-Preserving Article Transformer (DET-247…259) ---
  // Ingestion: text/url/pdf each create a source + fire the pipeline.
  createTextSource: (input: { text: string; title?: string }) =>
    request<TransformerSourceListItem>('/transformer/sources/text', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createUrlSource: (input: { url: string }) =>
    request<TransformerSourceListItem>('/transformer/sources/url', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createPdfSource: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return upload<TransformerSourceListItem>('/transformer/sources/pdf', form)
  },
  // Source list/detail + the debug-inspectable blocks (DET-250).
  listTransformerSources: () =>
    request<TransformerSourceListItem[]>('/transformer/sources'),
  getTransformerSource: (id: string) =>
    request<TransformerSourceDetail>(`/transformer/sources/${id}`),
  getTransformerSourceBlocks: (id: string) =>
    request<TransformerBlockView[]>(`/transformer/sources/${id}/blocks`),
  // Transform / re-run (409 if an article for the source is already in flight).
  transformSource: (id: string) =>
    request<{ id: string }>(`/transformer/sources/${id}/transform`, {
      method: 'POST',
    }),
  // The article + fidelity + coverage + status (poll while non-terminal).
  getTransformedArticle: (id: string) =>
    request<TransformedArticle>(`/transformer/articles/${id}`),
  // Blocks at the article's PINNED blocksVersion — the inspector must resolve
  // sourceBlockIds against the version the article was generated from, not the
  // source's current version (a re-extraction bumps it).
  getTransformedArticleBlocks: (id: string) =>
    request<TransformerBlockView[]>(`/transformer/articles/${id}/blocks`),

  // Illustration suggestions (DET-259): suggestions only, never images.
  generateIllustrations: (articleId: string) =>
    request<IllustrationPlan>(
      `/transformer/articles/${articleId}/illustrations`,
      { method: 'POST' },
    ),
  setIllustrationApproval: (
    articleId: string,
    suggestionId: string,
    approval: 'approved' | 'rejected',
  ) =>
    request<IllustrationPlan>(
      `/transformer/articles/${articleId}/illustrations/${suggestionId}`,
      { method: 'PATCH', body: JSON.stringify({ approval }) },
    ),

  // Illustration rendering (DET-261): render an APPROVED suggestion into an
  // image. High-risk suggestions require confirmHighRisk (server returns 409
  // otherwise). Returns the updated plan with `suggestion.image` populated.
  renderIllustration: (
    articleId: string,
    suggestionId: string,
    confirmHighRisk?: boolean,
  ) =>
    request<IllustrationPlan>(
      `/transformer/articles/${articleId}/illustrations/${suggestionId}/render`,
      {
        method: 'POST',
        body: JSON.stringify({ confirmHighRisk: !!confirmHighRisk }),
      },
    ),
  deleteIllustrationImage: (articleId: string, suggestionId: string) =>
    request<IllustrationPlan>(
      `/transformer/articles/${articleId}/illustrations/${suggestionId}/image`,
      { method: 'DELETE' },
    ),
  // Raw authenticated PNG fetch — an <img src> cannot send the bearer token, so
  // the panel fetches the bytes here and builds an object URL.
  getIllustrationImageBlob: async (articleId: string, suggestionId: string) => {
    const token = getToken()
    const workspaceId = getActiveWorkspaceId()
    const res = await fetch(
      `${API_URL}/transformer/articles/${articleId}/illustrations/${suggestionId}/image`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
        },
      },
    )
    if (!res.ok) {
      throw new ApiError(res.status, res.statusText || 'Could not load image.')
    }
    return res.blob()
  },

  // Learning layer (DET-258): AI-assisted, stored outside the article body.
  generateLearningLayer: (articleId: string) =>
    request<LearningLayer>(
      `/transformer/articles/${articleId}/learning-layer`,
      { method: 'POST' },
    ),
  setLearningItemValidation: (
    articleId: string,
    itemId: string,
    validationStatus: 'validated' | 'dismissed',
  ) =>
    request<LearningLayer>(
      `/transformer/articles/${articleId}/learning-layer/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify({ validationStatus }) },
    ),
  // Concept-extraction candidates (DET-283): per-section, AI-assisted proposals
  // stored on the learning layer. Validation reuses setLearningItemValidation.
  extractSectionConcepts: (articleId: string, sectionId: string) =>
    request<LearningLayer>(
      `/transformer/articles/${articleId}/sections/${sectionId}/concepts`,
      { method: 'POST' },
    ),

  // --- Concept Library (DET-187) ---
  // Create an INBOX "to learn" concept. Status is server-owned (always INBOX on
  // create) — the gate (DET-189) owns promotion. Deep Reading Mode's concept
  // extraction (DET-301) lands an approved candidate here as the real downstream
  // write, distinct from the article_learning_events log that records the action.
  createConcept: (input: {
    title: string
    summary?: string
    sourceText?: string
  }) =>
    request<Concept>('/concepts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // --- Article learning events (DET-278 / DET-301) ---
  // The source-of-truth activity log for the learning modes. Deep Reading Mode
  // hydrates from `list` on load (so completion markers survive a reload) and
  // appends each interaction through `create`. `user_id` is taken from the JWT.
  listArticleLearningEvents: (articleId: string) =>
    request<ArticleLearningEvent[]>(
      `/article-learning/events?articleId=${encodeURIComponent(articleId)}`,
    ),
  createArticleLearningEvent: (draft: ArticleLearningEventDraft) =>
    request<ArticleLearningEvent>('/article-learning/events', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  // --- Review prompts → Retrieval Engine (DET-301 / DET-288) ---
  // The real downstream sink for an approved Spaced Review prompt. Distinct from
  // the article_learning_events log (which records the approval ACTION): this
  // hands the prompt to the Retrieval Engine, which owns the schedule. Idempotent
  // server-side on the deterministic prompt_id, so re-approving updates in place.
  scheduleReviewPrompt: (input: ReviewPromptDraft) =>
    request<ReviewPromptWire>('/retrieval-events/prompts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // --- First-run onboarding (DET-307) ---
  // The guided "first source → first earned concept" walkthrough. Status reports a
  // checklist DERIVED server-side from real activity; `seedOnboardingStarter` seeds
  // the built-in starter article (idempotent) and returns its ids to deep-link in;
  // `updateOnboarding` dismisses it forever or marks a data-trail-less step (Map).
  getOnboarding: () => request<OnboardingStatus>('/onboarding'),
  seedOnboardingStarter: () =>
    request<OnboardingStarterSeed>('/onboarding/starter', { method: 'POST' }),
  updateOnboarding: (input: {
    dismissed?: boolean
    completedStep?: OnboardingStepKey
  }) =>
    request<OnboardingStatus>('/onboarding', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
}

// The snake_case fields the Retrieval Engine accepts for an approved prompt — a
// subset of the DET-288 ScheduledReviewPrompt contract (id/schedule/user are
// server-owned, so omitted). schedule_metadata / section_heading are not sent.
export interface ReviewPromptDraft {
  prompt_id: string
  article_id: string
  article_version_id?: string
  section_id?: string
  concept_id?: string
  prompt_type: string
  origin: string
  subject: string
  question: string
  expected_answer_summary: string
  source_span_ids?: string[]
  created_from_event_id?: string
}

// --- First-run onboarding (DET-307) ---
// Mirrors the server's ONBOARDING_STEP_KEYS (onboarding.steps.ts) — the guided
// walkthrough in order. Keep in sync.
export type OnboardingStepKey =
  | 'read'
  | 'predict'
  | 'approve'
  | 'earn'
  | 'map'
  | 'review'

export interface OnboardingStep {
  key: OnboardingStepKey
  done: boolean
}

// The walkthrough status the Today checklist reads. `active` is the single show/
// hide signal (not dismissed, not complete); `workspaceEmpty` + a seeded starter
// gate whether a brand-new user sees the first-run CTA.
export interface OnboardingStatus {
  active: boolean
  dismissed: boolean
  completed: boolean
  workspaceEmpty: boolean
  starterSourceId: string | null
  starterArticleId: string | null
  starterConceptId: string | null
  starterArticleStatus: TransformedArticleStatus | null
  steps: OnboardingStep[]
}

// The seeded starter's ids (POST /onboarding/starter) — the article to deep-link
// the walkthrough into, plus its source + companion inbox row.
export interface OnboardingStarterSeed {
  sourceId: string
  articleId: string
  conceptId: string
}

// The persisted prompt the engine returns (id/schedule/timestamps stamped on).
export interface ReviewPromptWire extends ReviewPromptDraft {
  id: string
  user_id: string
  status: string
  next_review_at?: string
  created_at: string
  updated_at: string
}
