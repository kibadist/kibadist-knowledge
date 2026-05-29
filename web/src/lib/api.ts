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
export type GateMode = 'QUICK' | 'DEEP'
export type CognitiveState = 'EXPLAINED' | 'LINKED'
export type ConceptStatus = 'INBOX' | 'ARTICULATED' | 'PERMANENT'

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
  mode: GateMode
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
  citations: string[]
  createdAt: string
}

// Read-only prior Q&A surfaced to the promote/compression wizard as reference
// scaffold. It must never prefill the user's articulation.
export interface ReferenceQa {
  questionText: string
  answerText: string
}

export interface PromotionState {
  conceptId: string
  title: string
  sourceText: string | null
  draft: PromotionDraft
  checklist: GateChecklist
  suggestedMode: GateMode
  referenceQa: ReferenceQa[]
}

export interface SuggestedConnection {
  targetConceptId: string
  title: string
  similarity: number
  snippet: string
}

export interface RetrievalGrade {
  score: number
  passed: boolean
  feedback: string | null
}

export interface ConnectionInput {
  targetConceptId: string
  relation?: string
}

export interface CommitPromotionInput {
  mode: GateMode
  isRoot: boolean
  connections: ConnectionInput[]
}

export interface Concept {
  id: string
  title: string
  summary: string | null
  sourceText: string | null
  captureSource: CaptureSource | null
  sourceUrl: string | null
  status: ConceptStatus
  cognitiveState: CognitiveState | null
  gateMode: GateMode | null
  createdAt: string
  updatedAt: string
}

export interface ConceptLinkEnd {
  id: string
  status: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED'
  relation: string | null
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

export interface ConceptDetail extends Concept {
  articulations: ConceptArticulation[]
  outgoingLinks: ConceptLinkEnd[]
  incomingLinks: ConceptLinkEnd[]
  retrievalEvents: ConceptRetrievalEvent[]
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
  setPromotionMode: (conceptId: string, mode: GateMode) =>
    request<PromotionState>(`/promotion/${conceptId}/mode`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
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
}
