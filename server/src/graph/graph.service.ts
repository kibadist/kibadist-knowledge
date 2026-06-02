import {
  type Certainty,
  type CognitiveState,
  type ConceptStatus,
  type LinkRelation,
  LinkStatus,
  type LivingConceptStatus,
  type QuestionActor,
} from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { currentActivation } from '../decay/decay'
import { PrismaService } from '../prisma/prisma.service'
import type { SavePositionsDto } from './dto/save-positions.dto'

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

  /** The live graph: earned nodes, their confirmed/suggested edges, and saved
   *  positions. Edges are filtered to the node set so the graph never references
   *  a node it didn't return. */
  async getGraph(userId: string, workspaceId: string): Promise<Graph> {
    const now = new Date()

    // Nodes = all earned (non-INBOX) concepts in the active workspace (DET-232).
    // Include the living-concept relation (id + status only) to compute
    // hasPersona/personaStatus without leaking text. Edges/positions are scoped
    // transitively: edges are filtered to this node set below, and a position only
    // exists for a concept the user owns.
    const concepts = await this.prisma.concept.findMany({
      where: { userId, workspaceId, status: { not: 'INBOX' } },
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
