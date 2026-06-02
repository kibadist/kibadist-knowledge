import {
  type Certainty,
  type CognitiveState,
  type ConceptStatus,
  GraphScope,
  type LinkRelation,
  LinkStatus,
  type LivingConceptStatus,
  type QuestionActor,
} from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { currentActivation } from '../decay/decay'
import { PrismaService } from '../prisma/prisma.service'
import type { SavePositionsDto } from './dto/save-positions.dto'

/**
 * A request to resolve a scoped slice of the graph (DET-236). `scope` decides
 * which target field is required: TRACK→trackId, DOMAIN→domainId, ARTICLE→
 * sourceConceptId, CONCEPT_NEIGHBORHOOD→centerConceptId (+ optional `hops` 1–2).
 * WORKSPACE needs no target. The nodes/edges are always resolved LIVE — a scope
 * is a query, never a stored subgraph.
 */
export interface GraphScopeSpec {
  scope: GraphScope
  sourceConceptId?: string
  trackId?: string
  domainId?: string
  centerConceptId?: string
  hops?: number
}

// The graph is always derived LIVE from Concept (nodes) + Link (edges); only the
// (x, y) coordinates are persisted (DET-230). No snapshot of nodes/edges exists.
interface GraphNode {
  id: string
  title: string
  summary: string | null
  cognitiveState: CognitiveState
  status: ConceptStatus
  certainty: Certainty
  currentActivation: number
  hasPersona: boolean
  personaStatus: LivingConceptStatus | null
  createdAt: string
}

interface GraphEdge {
  id: string
  sourceConceptId: string
  targetConceptId: string
  relationKind: LinkRelation | null
  relation: string | null
  status: 'SUGGESTED' | 'CONFIRMED'
  proposedBy: QuestionActor
  rationale: string | null
}

interface GraphPosition {
  conceptId: string
  x: number
  y: number
  locked: boolean
}

interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  positions: GraphPosition[]
}

/**
 * The Concept Graph / Overview Map (DET-230). Assembles the earned layer of the
 * user's knowledge: nodes are non-INBOX concepts, edges are SUGGESTED/CONFIRMED
 * Links between two nodes, positions are the user's hand-placed coordinates.
 *
 * Node activation is the SAME lazily-decayed value the concept list shows (DET-195),
 * computed via {@link currentActivation} so the graph fades idle nodes identically.
 */
// Documented ceiling on the live graph read (DET-229). The write path is already
// capped (SavePositionsDto @ArrayMaxSize 2000); this makes the read symmetric so a
// heavy long-term user can't force an unbounded payload + O(N) client-side layout.
// The newest concepts win (orderBy createdAt desc); a richer "filter by state"
// path is the follow-up if anyone legitimately exceeds this.
const MAX_GRAPH_NODES = 2000
// Edges are bounded too — comfortably above MAX_GRAPH_NODES since a node can carry
// several links, but still finite so one request can't serialize the whole table.
const MAX_GRAPH_EDGES = 8000

@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The live WORKSPACE graph (DET-230/236): earned nodes, their confirmed/
   * suggested edges, and saved positions. Thin wrapper over {@link getScopedGraph}
   * with the WORKSPACE scope, kept so existing callers (`GET /graph`) are
   * unchanged.
   */
  getGraph(userId: string, workspaceId: string): Promise<Graph> {
    return this.getScopedGraph(userId, workspaceId, {
      scope: GraphScope.WORKSPACE,
    })
  }

  /**
   * The live graph for a given scope (DET-236). Resolves the scope to a concept-id
   * set (null = the whole workspace), then assembles nodes/edges/positions over
   * the SAME live Concept/Link data — no snapshot, ever. Edges are restricted to
   * pairs where BOTH endpoints are in the returned node set, so a scoped view
   * never references a node outside it.
   */
  async getScopedGraph(
    userId: string,
    workspaceId: string,
    spec: GraphScopeSpec,
  ): Promise<Graph> {
    const now = new Date()

    // Resolve the scope to its concept-id set. `null` means "the whole workspace"
    // (the WORKSPACE scope), which keeps the original unfiltered, capped query.
    const scopedIds = await this.resolveScopeConceptIds(
      userId,
      workspaceId,
      spec,
    )

    // Nodes = earned (non-INBOX) concepts in the active workspace (DET-232),
    // narrowed to the scope's id set when one was resolved. Include the
    // living-concept relation (id + status only) to compute hasPersona/
    // personaStatus without leaking text.
    const concepts = await this.prisma.concept.findMany({
      where: {
        userId,
        workspaceId,
        status: { not: 'INBOX' },
        ...(scopedIds === null ? {} : { id: { in: scopedIds } }),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_GRAPH_NODES,
      include: { livingConcept: { select: { id: true, status: true } } },
    })

    const nodes: GraphNode[] = concepts.map((concept) => {
      // An ARCHIVED (retired) persona is treated as absent on the map: it shows no
      // "Living" chip and is hidden from the inspector's active card (DET-227), so
      // hasPersona/personaStatus must ignore it.
      const persona = concept.livingConcept
      const personaActive = persona !== null && persona.status !== 'ARCHIVED'
      return {
        id: concept.id,
        title: concept.title,
        summary: concept.summary,
        cognitiveState: concept.cognitiveState,
        status: concept.status,
        certainty: concept.certainty,
        currentActivation: currentActivation(
          concept.activation,
          concept.activationAt,
          now,
        ),
        hasPersona: personaActive,
        personaStatus: personaActive ? persona.status : null,
        createdAt: concept.createdAt.toISOString(),
      }
    })

    // The set of node ids, so edges that touch an INBOX/absent concept are dropped.
    const nodeIds = new Set(nodes.map((n) => n.id))

    // Edges = SUGGESTED/CONFIRMED links (REJECTED excluded). Filtered in-memory to
    // pairs where BOTH endpoints are in the node set.
    const links = await this.prisma.link.findMany({
      where: {
        userId,
        status: { in: [LinkStatus.SUGGESTED, LinkStatus.CONFIRMED] },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_GRAPH_EDGES,
    })

    const edges: GraphEdge[] = links
      .filter(
        (link) =>
          nodeIds.has(link.sourceConceptId) &&
          nodeIds.has(link.targetConceptId),
      )
      .map((link) => ({
        id: link.id,
        sourceConceptId: link.sourceConceptId,
        targetConceptId: link.targetConceptId,
        relationKind: link.relationKind,
        relation: link.relation,
        // Narrowed by the where clause above.
        status: link.status as 'SUGGESTED' | 'CONFIRMED',
        proposedBy: link.proposedBy,
        rationale: link.rationale,
      }))

    const positionRows = await this.prisma.graphNodePosition.findMany({
      where: { userId },
    })

    const positions: GraphPosition[] = positionRows.map((p) => ({
      conceptId: p.conceptId,
      x: p.x,
      y: p.y,
      locked: p.locked,
    }))

    return { nodes, edges, positions }
  }

  /**
   * Resolve a scope spec to the set of concept ids it covers (DET-236), or `null`
   * for WORKSPACE (meaning "every earned concept", handled by the unfiltered
   * node query). Every targeted scope re-checks ownership/workspace so a scope
   * can't reach into another world. The returned ids are a superset filter — the
   * node query still excludes INBOX and applies the node cap.
   */
  private async resolveScopeConceptIds(
    userId: string,
    workspaceId: string,
    spec: GraphScopeSpec,
  ): Promise<string[] | null> {
    switch (spec.scope) {
      case GraphScope.WORKSPACE:
        return null

      case GraphScope.TRACK: {
        if (!spec.trackId) {
          throw new BadRequestException('trackId is required for TRACK scope')
        }
        // The track must belong to a workspace this user owns.
        const track = await this.prisma.track.findFirst({
          where: {
            id: spec.trackId,
            workspaceId,
            workspace: { ownerUserId: userId },
          },
          select: { id: true },
        })
        if (!track) throw new NotFoundException('Track not found')
        const rows = await this.prisma.trackConcept.findMany({
          where: { trackId: spec.trackId },
          select: { conceptId: true },
        })
        return rows.map((r) => r.conceptId)
      }

      case GraphScope.DOMAIN: {
        if (!spec.domainId) {
          throw new BadRequestException('domainId is required for DOMAIN scope')
        }
        const domain = await this.prisma.domain.findFirst({
          where: {
            id: spec.domainId,
            workspaceId,
            workspace: { ownerUserId: userId },
          },
          select: { id: true },
        })
        if (!domain) throw new NotFoundException('Domain not found')
        const rows = await this.prisma.conceptDomain.findMany({
          where: { domainId: spec.domainId },
          select: { conceptId: true },
        })
        return rows.map((r) => r.conceptId)
      }

      case GraphScope.ARTICLE: {
        if (!spec.sourceConceptId) {
          throw new BadRequestException(
            'sourceConceptId is required for ARTICLE scope',
          )
        }
        const source = await this.prisma.concept.findFirst({
          where: { id: spec.sourceConceptId, userId, workspaceId },
          select: { id: true, sourceUrl: true },
        })
        if (!source) throw new NotFoundException('Source concept not found')
        // "Concepts from this article": the source concept itself plus any earned
        // concept sharing its source origin (`sourceUrl`). NOTE: DET-211 does not
        // persist a candidate→promoted-concept lineage, so shared source origin is
        // the honest "same article" signal available; a dedicated lineage link is
        // a future refinement if richer article grouping is needed.
        const ids = new Set<string>([source.id])
        if (source.sourceUrl) {
          const sameSource = await this.prisma.concept.findMany({
            where: {
              userId,
              workspaceId,
              sourceUrl: source.sourceUrl,
              status: { not: 'INBOX' },
            },
            select: { id: true },
          })
          for (const c of sameSource) ids.add(c.id)
        }
        return [...ids]
      }

      case GraphScope.CONCEPT_NEIGHBORHOOD: {
        if (!spec.centerConceptId) {
          throw new BadRequestException(
            'centerConceptId is required for CONCEPT_NEIGHBORHOOD scope',
          )
        }
        const center = await this.prisma.concept.findFirst({
          where: { id: spec.centerConceptId, userId, workspaceId },
          select: { id: true },
        })
        if (!center) throw new NotFoundException('Center concept not found')
        // Breadth-first over SUGGESTED/CONFIRMED links, 1–2 hops (clamped). Each
        // hop expands the frontier by the links touching it; INBOX/foreign ids
        // that sneak in are dropped later by the node query's workspace/status
        // filter, so this only needs to bound the id set.
        const hops = Math.min(2, Math.max(1, spec.hops ?? 1))
        const all = new Set<string>([center.id])
        let frontier = new Set<string>([center.id])
        for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
          const links = await this.prisma.link.findMany({
            where: {
              userId,
              status: { in: [LinkStatus.SUGGESTED, LinkStatus.CONFIRMED] },
              OR: [
                { sourceConceptId: { in: [...frontier] } },
                { targetConceptId: { in: [...frontier] } },
              ],
            },
            select: { sourceConceptId: true, targetConceptId: true },
          })
          const next = new Set<string>()
          for (const link of links) {
            for (const id of [link.sourceConceptId, link.targetConceptId]) {
              if (!all.has(id)) {
                all.add(id)
                next.add(id)
              }
            }
          }
          frontier = next
        }
        return [...all]
      }

      // Defined in the data model but out of build scope for the MVP (DET-231).
      case GraphScope.MISCONCEPTION:
      case GraphScope.REVIEW:
        throw new BadRequestException(
          `Graph scope ${spec.scope} is not available in the MVP`,
        )
    }
  }

  /**
   * Persist the user's manual node placements (DET-230). Each position is asserted
   * owned + earned (non-INBOX) before upsert, so a caller can't write a layout for
   * a concept it doesn't own or for raw inbox material. All upserts run in one
   * transaction. Returns how many positions were saved.
   */
  async savePositions(
    userId: string,
    dto: SavePositionsDto,
  ): Promise<{ saved: number }> {
    // De-dupe by conceptId (last position wins) so the same node sent twice in one
    // batch doesn't upsert twice in the transaction.
    const byConcept = new Map<string, (typeof dto.positions)[number]>()
    for (const position of dto.positions) {
      byConcept.set(position.conceptId, position)
    }
    const positions = [...byConcept.values()]
    const ids = [...byConcept.keys()]

    // One ownership check for the whole batch instead of N round-trips: every
    // conceptId must be an owned, earned (non-INBOX) concept. A concept belongs to
    // exactly one user, so a matching count proves ownership of all of them.
    const owned = await this.prisma.concept.count({
      where: { id: { in: ids }, userId, status: { not: 'INBOX' } },
    })
    if (owned !== ids.length) {
      throw new NotFoundException('One or more concepts not found')
    }

    // `locked` is deferred (DET-226): we only ever write coordinates. The DB column
    // keeps its default(false) on create and is left untouched on update.
    await this.prisma.$transaction(
      positions.map((position) =>
        this.prisma.graphNodePosition.upsert({
          where: { conceptId: position.conceptId },
          create: {
            conceptId: position.conceptId,
            userId,
            x: position.x,
            y: position.y,
          },
          update: {
            x: position.x,
            y: position.y,
          },
        }),
      ),
    )

    return { saved: positions.length }
  }
}
