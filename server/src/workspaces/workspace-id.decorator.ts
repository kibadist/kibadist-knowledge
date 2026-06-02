import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

/**
 * The REQUESTED active workspace for this request (DET-232), read from the
 * `X-Workspace-Id` header or a `?workspaceId` query param. Returns the raw
 * string, or `undefined` when neither is present.
 *
 * This is only the client's *request* — it is NOT trusted. Resolve it through
 * {@link WorkspacesService.resolveActiveWorkspaceId}, which validates ownership
 * and falls back to the user's default workspace when this is undefined (so a
 * client that sends no header keeps working unchanged until the switcher lands,
 * DET-233).
 */
export const WorkspaceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>()
    const header = request.headers['x-workspace-id']
    const fromHeader = Array.isArray(header) ? header[0] : header
    if (fromHeader && fromHeader.trim()) return fromHeader.trim()

    const query = request.query as Record<string, unknown> | undefined
    const fromQuery = query?.workspaceId
    if (typeof fromQuery === 'string' && fromQuery.trim()) {
      return fromQuery.trim()
    }
    return undefined
  },
)
