import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { UsersService } from '../users/users.service'
import type { AuthUser, JwtPayload } from './auth.types'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_SECRET')
    if (!secret) {
      throw new Error('JWT_SECRET is not configured')
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    })
  }

  // Re-checks the user still exists so a token for a deleted account is rejected
  // (the payload is not trusted on its own). The return value becomes request.user.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.usersService.findById(payload.sub)
    if (!user) {
      throw new UnauthorizedException()
    }
    return { userId: user.id, email: user.email }
  }
}
