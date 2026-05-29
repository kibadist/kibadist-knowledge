import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { AuthUser, RequestWithUser } from './auth.types'

/** Extracts the authenticated user (set by JwtStrategy) from the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>()
    return request.user
  },
)
