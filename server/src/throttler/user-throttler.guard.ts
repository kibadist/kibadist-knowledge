import type { ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'

/**
 * Rate-limits per authenticated USER rather than per IP. This API is auth'd
 * (global JwtAuthGuard), so IP keying is too coarse — many users can share one
 * NAT'd IP, and one user can rotate IPs. Keying on the user id makes the limit
 * actually bound a single account's spend on paid AI calls (DET-207).
 *
 * The JwtAuthGuard runs first (registered before this guard in app.module
 * APP_GUARD providers) and populates `req.user`. If for any reason it isn't set
 * (a @Public() route, or guard-ordering surprise), we fall back to the client
 * IP rather than throw — a missing tracker would 500 an otherwise-valid request.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as AuthUser | undefined
    const ip = req.ip as string | undefined
    return Promise.resolve(user?.userId ?? ip ?? 'unknown')
  }

  /**
   * Local-dev escape hatch: set THROTTLE_DISABLED=true in server/.env to bypass
   * rate limiting while hammering the AI pipeline by hand. Defaults to OFF, so
   * production (where the var is unset) keeps the DET-207 ceilings intact.
   */
  protected shouldSkip(_context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(process.env.THROTTLE_DISABLED === 'true')
  }
}
