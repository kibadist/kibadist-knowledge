import type { FastifyRequest } from 'fastify'

export interface JwtPayload {
  sub: string
  email: string
}

export interface AuthUser {
  userId: string
  email: string
}

export interface RequestWithUser extends FastifyRequest {
  user: AuthUser
}

export interface AuthResponse {
  access_token: string
  token_type: 'bearer'
  user: {
    id: string
    email: string
    name: string | null
  }
}
