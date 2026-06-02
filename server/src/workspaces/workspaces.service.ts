import type { Workspace } from '@kibadist/prisma'
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateWorkspaceDto } from './dto/create-workspace.dto'
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto'

/** The name a user's first, auto-provisioned workspace is given. */
const DEFAULT_WORKSPACE_NAME = 'My Knowledge'

/**
 * Workspaces (DET-232): the tenancy boundary that owns Concepts. This service is
 * the single authority on "which workspace is this request acting in", and the
 * only place a default workspace is minted. It does NOT touch Domains/Tracks/the
 * Proof-of-Learning gate — pure tenancy.
 *
 * Every method is scoped to the authenticated user: a workspace is matched by
 * `{ id, ownerUserId }`, never by id alone, so one user can't read or mutate
 * another's workspace (single-owner MVP; members/permissions are deferred).
 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** A user's workspaces, oldest first — the first created is their default. */
  findAllForUser(userId: string): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    })
  }

  create(userId: string, dto: CreateWorkspaceDto): Promise<Workspace> {
    return this.prisma.workspace.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        ownerUserId: userId,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWorkspaceDto,
  ): Promise<Workspace> {
    await this.assertOwned(userId, id)
    return this.prisma.workspace.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        // Allow clearing the description with an empty string.
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
      },
    })
  }

  /**
   * Delete a workspace and (by cascade) the concepts it owns. A user's LAST
   * workspace can never be deleted — every account must always have at least one
   * world to capture into, and {@link resolveActiveWorkspaceId} assumes one exists.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id)
    const total = await this.prisma.workspace.count({
      where: { ownerUserId: userId },
    })
    if (total <= 1) {
      throw new ConflictException('Cannot delete your only workspace')
    }
    await this.prisma.workspace.delete({ where: { id } })
  }

  /** Throws NotFound unless the workspace exists and belongs to the user. */
  async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.workspace.findFirst({
      where: { id, ownerUserId: userId },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Workspace not found')
  }

  /**
   * Resolve the workspace a request should act in (DET-232). If the client sent
   * a workspace id (header/query, via {@link WorkspaceId}) it must belong to the
   * user; otherwise we fall back to the user's default workspace. This keeps
   * existing single-workspace clients working with zero changes until the
   * switcher (DET-233) starts sending `X-Workspace-Id`.
   */
  async resolveActiveWorkspaceId(
    userId: string,
    requestedWorkspaceId?: string,
  ): Promise<string> {
    if (requestedWorkspaceId) {
      const owned = await this.prisma.workspace.findFirst({
        where: { id: requestedWorkspaceId, ownerUserId: userId },
        select: { id: true },
      })
      if (!owned) throw new NotFoundException('Workspace not found')
      return owned.id
    }
    return this.defaultWorkspaceId(userId)
  }

  /**
   * The user's default workspace id: their earliest-created workspace. Self-heals
   * by provisioning one if (defensively) none exists, so no read path can ever
   * fail for a workspace-less user.
   */
  async defaultWorkspaceId(userId: string): Promise<string> {
    const workspace = await this.ensureDefaultWorkspace(userId)
    return workspace.id
  }

  /**
   * Guarantee the user has at least one workspace, returning their default
   * (earliest) one. Idempotent — called at registration to auto-provision a
   * first world, and as the self-healing fallback in resolution.
   */
  async ensureDefaultWorkspace(userId: string): Promise<Workspace> {
    const existing = await this.prisma.workspace.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    })
    if (existing) return existing
    return this.prisma.workspace.create({
      data: { name: DEFAULT_WORKSPACE_NAME, ownerUserId: userId },
    })
  }
}
