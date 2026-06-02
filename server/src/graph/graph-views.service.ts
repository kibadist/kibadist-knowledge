import { GraphScope, type GraphView, Prisma } from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateGraphViewDto } from './dto/create-graph-view.dto'
import type { UpdateGraphViewDto } from './dto/update-graph-view.dto'
import { type GraphScopeSpec, GraphService } from './graph.service'

/**
 * GraphView CRUD (DET-236): saved, scoped lenses over the live graph. A view
 * stores only the scope + its target + view prefs; resolving it (re)computes the
 * nodes/edges live via {@link GraphService.getScopedGraph}. Deleting a view never
 * touches concepts, links, or positions. Workspace-scoped; mutations by view id
 * re-check ownership by joining through `workspace.ownerUserId`.
 */
@Injectable()
export class GraphViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  findAllForWorkspace(workspaceId: string): Promise<GraphView[]> {
    return this.prisma.graphView.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(
    workspaceId: string,
    dto: CreateGraphViewDto,
  ): Promise<GraphView> {
    // The scope's required target must be present at save time (a saved view
    // should be resolvable). WORKSPACE needs none. `async` so this synchronous
    // validation surfaces as a rejected promise, not a thrown call.
    this.assertTargetForScope(dto.scope, dto)
    return this.prisma.graphView.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        scope: dto.scope,
        sourceConceptId: dto.sourceConceptId ?? null,
        trackId: dto.trackId ?? null,
        domainId: dto.domainId ?? null,
        centerConceptId: dto.centerConceptId ?? null,
        filters: (dto.filters ?? {}) as Prisma.InputJsonValue,
        layout: (dto.layout ?? {}) as Prisma.InputJsonValue,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateGraphViewDto,
  ): Promise<GraphView> {
    const existing = await this.assertOwnedView(userId, id)
    // Validate the resulting scope/target combination (post-merge).
    const scope = dto.scope ?? existing.scope
    this.assertTargetForScope(scope, {
      sourceConceptId: dto.sourceConceptId ?? existing.sourceConceptId,
      trackId: dto.trackId ?? existing.trackId,
      domainId: dto.domainId ?? existing.domainId,
      centerConceptId: dto.centerConceptId ?? existing.centerConceptId,
    })
    return this.prisma.graphView.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        scope: dto.scope,
        sourceConceptId: dto.sourceConceptId,
        trackId: dto.trackId,
        domainId: dto.domainId,
        centerConceptId: dto.centerConceptId,
        filters: dto.filters as Prisma.InputJsonValue | undefined,
        layout: dto.layout as Prisma.InputJsonValue | undefined,
      },
    })
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwnedView(userId, id)
    await this.prisma.graphView.delete({ where: { id } })
  }

  /**
   * Resolve a saved view to its live `{ nodes, edges, positions }`. Re-checks
   * ownership, then delegates to the scoped resolver with the view's stored
   * scope/target — so the graph is always current, never a snapshot.
   */
  async resolve(userId: string, id: string) {
    const view = await this.assertOwnedView(userId, id)
    return this.graph.getScopedGraph(userId, view.workspaceId, viewToSpec(view))
  }

  /** Load a view and assert the user owns its workspace. Returns the row. */
  async assertOwnedView(userId: string, id: string): Promise<GraphView> {
    const view = await this.prisma.graphView.findFirst({
      where: { id, workspace: { ownerUserId: userId } },
    })
    if (!view) throw new NotFoundException('Graph view not found')
    return view
  }

  /** Throw unless the scope's required target id is present. */
  private assertTargetForScope(
    scope: GraphScope,
    target: {
      sourceConceptId?: string | null
      trackId?: string | null
      domainId?: string | null
      centerConceptId?: string | null
    },
  ): void {
    const missing = (field: string) =>
      new BadRequestException(`${field} is required for ${scope} scope`)
    switch (scope) {
      case GraphScope.ARTICLE:
        if (!target.sourceConceptId) throw missing('sourceConceptId')
        break
      case GraphScope.TRACK:
        if (!target.trackId) throw missing('trackId')
        break
      case GraphScope.DOMAIN:
        if (!target.domainId) throw missing('domainId')
        break
      case GraphScope.CONCEPT_NEIGHBORHOOD:
        if (!target.centerConceptId) throw missing('centerConceptId')
        break
      case GraphScope.MISCONCEPTION:
      case GraphScope.REVIEW:
        throw new BadRequestException(
          `Graph scope ${scope} is not available in the MVP`,
        )
      default:
        // WORKSPACE needs no target.
        break
    }
  }
}

/** Map a stored GraphView row to the resolver's scope spec. */
function viewToSpec(view: GraphView): GraphScopeSpec {
  return {
    scope: view.scope,
    sourceConceptId: view.sourceConceptId ?? undefined,
    trackId: view.trackId ?? undefined,
    domainId: view.domainId ?? undefined,
    centerConceptId: view.centerConceptId ?? undefined,
  }
}
