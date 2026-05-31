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
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      // Only declare a JSON content-type when we actually send a body. Fastify
      // rejects an empty body sent with `application/json` (FST_ERR_CTP_EMPTY_
      // JSON_BODY), which would otherwise break bodyless POSTs (e.g. generating
      // interrogation questions, retrieval prompts, marking connections reviewed).
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  return parseResponse<T>(res)
}

// Multipart upload: never set Content-Type — the browser must add the
// multipart boundary itself.
async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

export interface Note {
  id: string
  title: string
  body: string
  createdAt: string
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

export interface InboxItem {
  id: string
  title: string
  captureSource: CaptureSource | null
  sourceUrl: string | null
  excerpt: string
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
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

// One concept in a session's queue, in presentation order, with its grade once
// reviewed (null until reached).
export interface SessionItem {
  id: string
  conceptId: string
  title: string
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

export const api = {
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
  listNotes: () => request<Note[]>('/notes'),
  createNote: (input: { title: string; body?: string }) =>
    request<Note>('/notes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // --- Capture inbox (DET-187) ---
  listInbox: () => request<InboxItem[]>('/inbox'),
  captureText: (input: { text: string; title?: string }) =>
    request<InboxItem>('/inbox/text', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  captureUrl: (input: { url: string }) =>
    request<InboxItem>('/inbox/url', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  capturePdf: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return upload<InboxItem>('/inbox/pdf', form)
  },
  discardInboxItem: (id: string) =>
    request<void>(`/inbox/${id}`, { method: 'DELETE' }),
  getInboxItem: (id: string) => request<InboxItemDetail>(`/inbox/${id}`),

  // --- Semantic Chunking + Concept Library (DET-211) ---
  getInboxChunks: (id: string) =>
    request<ConceptChunk[]>(`/inbox/${id}/chunks`),

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
  getPromotion: (conceptId: string) =>
    request<PromotionState>(`/promotion/${conceptId}`),
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
  askSourceQuestion: (conceptId: string, questionText: string) =>
    request<SourceQuestion>(`/source-qa/${conceptId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ questionText }),
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
  reviewSessionItem: (sessionId: string, conceptId: string, score: number) =>
    request<GradeResult>(`/sessions/${sessionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ conceptId, score }),
    }),
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
}
