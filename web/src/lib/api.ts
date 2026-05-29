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
}
