import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'

import { UsersService } from '../users/users.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import type { AuthResponse, AuthUser, JwtPayload } from './auth.types'

const BCRYPT_ROUNDS = 10

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /** Used by LocalStrategy to verify credentials on login. */
  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    const user = await this.usersService.findByEmail(email)
    if (!user) {
      return null
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return null
    }
    return { userId: user.id, email: user.email }
  }

  async register(input: {
    email: string
    password: string
    name?: string
  }): Promise<AuthResponse> {
    const existing = await this.usersService.findByEmail(input.email)
    if (existing) {
      throw new ConflictException('An account with this email already exists')
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    try {
      const user = await this.usersService.create({
        email: input.email,
        name: input.name,
        passwordHash,
      })
      // Auto-provision a default workspace so a new account is never
      // workspace-less (DET-232): every concept it captures needs a workspace to
      // be owned by, and the active-workspace resolver assumes one exists.
      await this.workspacesService.ensureDefaultWorkspace(user.id)
      return this.buildAuthResponse(user.id, user.email, user.name)
    } catch (error) {
      // Unique-constraint race: a concurrent request registered the same email
      // between the check above and this insert.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('An account with this email already exists')
      }
      throw error
    }
  }

  /** Builds the auth response after LocalStrategy has validated the user. */
  async login(authUser: AuthUser): Promise<AuthResponse> {
    const user = await this.usersService.findById(authUser.userId)
    if (!user) {
      throw new UnauthorizedException()
    }
    return this.buildAuthResponse(user.id, user.email, user.name)
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId)
    if (!user) {
      throw new UnauthorizedException()
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    }
  }

  private buildAuthResponse(
    id: string,
    email: string,
    name: string | null,
  ): AuthResponse {
    const payload: JwtPayload = { sub: id, email }
    return {
      access_token: this.jwtService.sign(payload),
      token_type: 'bearer',
      user: { id, email, name },
    }
  }
}
