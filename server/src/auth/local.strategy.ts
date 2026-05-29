import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-local'
import { AuthService } from './auth.service'
import type { AuthUser } from './auth.types'

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' })
  }

  async validate(email: string, password: string): Promise<AuthUser> {
    const user = await this.authService.validateUser(email, password)
    if (!user) {
      throw new UnauthorizedException('Incorrect email or password')
    }
    return user
  }
}
