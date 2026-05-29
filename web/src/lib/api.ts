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
      'Content-Type': 'application/json',
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
}
