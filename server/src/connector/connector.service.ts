import {
  ConceptStatus,
  LinkRelation,
  LinkStatus,
  Prisma,
  QuestionActor,
} from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import { SearchService } from '../search/search.service'
import {
  buildConnectorPrompt,
  type ConnectorCandidate,
  MAX_CANDIDATES,
  parseConnectorClassifications,
} from './connector.prompt'

/** A typed, user-approvable proposal the Connector surfaced. NOT an edge. */
export interface ConnectorProposal {
  targetConceptId: string
  title: string
  relationKind: LinkRelation
  rationale: string
  similarity: number
}

/**
 * The Connector (DET-191). Surfaces TYPED relationships between a concept and
 * existing concepts so the USER can draw the edges. The AI proposes; nothing it
 * returns becomes a CONFIRMED edge without an explicit user action.
 *
 * Two surfaces, one classification core:
 *  - {@link proposeEphemeral} runs DURING promotion while the concept is still
 *    INBOX. It PERSISTS NOTHING — INBOX concepts must never get a Link row
 *    (DET-187). It returns ephemeral proposals for the gate UI.
 *  - {@link proposeAndPersist} runs AFTER promotion, when the concept is
 *    PERMANENT, and UPSERTS each proposal as a SUGGESTED Link row for later
 *    user approval.
 *
 * Both skip pairs that already carry a remembered decision: a CONFIRMED edge
 * already exists, or a REJECTED row the user dismissed. SUGGESTED/REJECTED rows
 * are never graph edges — only CONFIRMED links are.
 */
@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly search: SearchService,
    private readonly concepts: ConceptsService,
  ) {}

  /**
   * DURING promotion (concept still INBOX): vector-search neighbors of the
   * staged articulation, classify the typed relationship for each, and return
   * up to {@link MAX_CANDIDATES} proposals. PERSISTS NOTHING. Best-effort: any
   * failure logs a warning and returns [] so the gate is never blocked.
   */
  async proposeEphemeral(
    userId: string,
    conceptId: string,
    articulation: string,
  ): Promise<ConnectorProposal[]> {
    try {
      return await this.computeProposals(userId, conceptId, articulation)
    } catch (error) {
      this.logger.warn(
        `Ephemeral connector proposals failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  /**
   * AFTER promotion (concept must be PERMANENT/non-inbox): re-run the proposal
   * logic against the concept's most recent articulation and UPSERT each
   * proposal as a SUGGESTED Link row (proposedBy=AI). Skips any pair that
   * already has a link row (the unique [source,target] constraint), catching
   * P2002 per row. Best-effort/non-throwing so a failed background pass never
   * corrupts state.
   */
  async proposeAndPersist(userId: string, conceptId: string): Promise<void> {
    try {
      await this.concepts.assertOwnedNonInbox(userId, conceptId)

      const latest = await this.prisma.articulation.findFirst({
        where: { conceptId, userId },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      })
      const articulation = latest?.body?.trim()
      if (!articulation) return

      const proposals = await this.computeProposals(
        userId,
        conceptId,
        articulation,
      )

      for (const proposal of proposals) {
        try {
          await this.prisma.link.create({
            data: {
              sourceConceptId: conceptId,
              targetConceptId: proposal.targetConceptId,
              relationKind: proposal.relationKind,
              rationale: proposal.rationale,
              proposedBy: QuestionActor.AI,
              status: LinkStatus.SUGGESTED,
              userId,
            },
          })
        } catch (error) {
          // A row already exists for this pair (the @@unique constraint) — the
          // user already decided, or a prior pass proposed it. Skip, don't fail.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            continue
          }
          throw error
        }
      }
    } catch (error) {
      this.logger.warn(
        `Background connector pass failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Shared core: search neighbors → collapse to best-per-concept → drop self and
   * remembered (CONFIRMED/REJECTED) pairs → cap → classify via AI → map back to
   * proposals. Reuses the dedupe/title-lookup approach from
   * PromotionService.suggestConnections. May throw; callers wrap it best-effort.
   */
  private async computeProposals(
    userId: string,
    conceptId: string,
    articulation: string,
  ): Promise<ConnectorProposal[]> {
    const text = articulation.trim()
    if (!text) return []

    // Over-fetch so collapsing duplicate articulations of one concept still
    // leaves enough distinct candidates after we cap.
    const matches = await this.search.searchArticulations(
      userId,
      text,
      MAX_CANDIDATES * 3,
    )

    // Collapse to the best-similarity match per concept; never include self.
    const bestByConcept = new Map<string, (typeof matches)[number]>()
    for (const m of matches) {
      if (m.conceptId === conceptId) continue
      const prev = bestByConcept.get(m.conceptId)
      if (!prev || m.similarity > prev.similarity) {
        bestByConcept.set(m.conceptId, m)
      }
    }
    if (bestByConcept.size === 0) return []

    // Remembered decisions: a CONFIRMED edge already exists, or the user
    // REJECTED a prior proposal for this pair. Either way, don't re-surface it.
    // The check is bidirectional — a decision on A↔B suppresses re-proposing the
    // same conceptual pair in either direction, so a rejection isn't defeated by
    // promoting the other concept later (the anti-behavior "re-proposing rejected
    // suggestions"). Edge identity stays directional in the schema; only the
    // suppression is symmetric.
    const candidateIds = [...bestByConcept.keys()]
    const decided = await this.prisma.link.findMany({
      where: {
        userId,
        status: { in: [LinkStatus.CONFIRMED, LinkStatus.REJECTED] },
        OR: [
          { sourceConceptId: conceptId, targetConceptId: { in: candidateIds } },
          { sourceConceptId: { in: candidateIds }, targetConceptId: conceptId },
        ],
      },
      select: { sourceConceptId: true, targetConceptId: true },
    })
    for (const { sourceConceptId, targetConceptId } of decided) {
      // Delete whichever endpoint is the candidate (the other is this concept).
      bestByConcept.delete(
        sourceConceptId === conceptId ? targetConceptId : sourceConceptId,
      )
    }
    if (bestByConcept.size === 0) return []

    // Load titles + a representative articulation for each surviving candidate.
    const concepts = await this.prisma.concept.findMany({
      where: {
        id: { in: [...bestByConcept.keys()] },
        userId,
        status: { not: ConceptStatus.INBOX },
      },
      select: { id: true, title: true },
    })
    const titleById = new Map(concepts.map((c) => [c.id, c.title]))

    // Cap to MAX_CANDIDATES, strongest similarity first.
    const ranked = [...bestByConcept.values()]
      .filter((m) => titleById.has(m.conceptId))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_CANDIDATES)
    if (ranked.length === 0) return []

    const candidates: ConnectorCandidate[] = ranked.map((m, index) => ({
      index,
      title: titleById.get(m.conceptId) as string,
      // The matched articulation body is a representative compression.
      articulation: m.body,
    }))

    // Classify the typed relationship for each candidate.
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { title: true },
    })
    const { system, prompt } = buildConnectorPrompt({
      concept: { title: concept?.title ?? '', articulation: text },
      candidates,
    })
    const result = await this.ai.complete({
      system,
      prompt,
      temperature: 0,
      maxTokens: 600,
    })
    const classifications = parseConnectorClassifications(
      result.text,
      candidates.length,
    )

    // Map each classification back to its candidate by index.
    const proposals: ConnectorProposal[] = []
    for (const c of classifications) {
      const match = ranked[c.index]
      if (!match) continue
      proposals.push({
        targetConceptId: match.conceptId,
        title: titleById.get(match.conceptId) as string,
        relationKind: c.relationKind,
        rationale: c.rationale,
        similarity: match.similarity,
      })
    }
    return proposals.slice(0, MAX_CANDIDATES)
  }
}
