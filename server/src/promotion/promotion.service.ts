import {
  type CognitiveState,
  ConceptStatus,
  GateMode,
  LinkStatus,
  Prisma,
} from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import { SearchService } from '../search/search.service'
import type { CommitPromotionDto } from './dto/commit-promotion.dto'
import {
  buildGradePrompt,
  buildQuestionPrompt,
  isPassingScore,
  parseGrade,
  parseQuestion,
} from './gate.prompt'
import {
  type ConnectionDecision,
  evaluateGates,
  type GateChecklist,
} from './gates'

/** Below this max similarity to existing concepts, the topic looks novel and we
 *  suggest the DEEP gate. Mirrors the intake interrogator's familiarity seam. */
const NOVELTY_THRESHOLD = 0.5
const SUGGESTION_LIMIT = 5

export interface PromotionDraftDto {
  conceptId: string
  mode: GateMode
  articulation: string | null
  connectionsReviewed: boolean
  retrievalQuestion: string | null
  retrievalResponse: string | null
  retrievalScore: number | null
}

export interface SuggestedConnection {
  targetConceptId: string
  title: string
  similarity: number
  snippet: string
}

export interface PromotionStateDto {
  conceptId: string
  title: string
  sourceText: string | null
  draft: PromotionDraftDto
  checklist: GateChecklist
  suggestedMode: GateMode
}

/**
 * The Proof-of-Learning Gate (DET-189). Orchestrates the four gates — Articulate,
 * Connect, Retrieve, Validate — over a staging {@link PromotionDraft}, and is the
 * ONLY path that can move a concept from INBOX to PERMANENT.
 *
 * Knowledge artifacts (Articulation, Link, RetrievalEvent) are never attached to
 * the live INBOX concept mid-flow — that would break the DET-187 invariant. They
 * are written only inside the commit transaction, as the status flips.
 */
@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly ai: AiService,
    private readonly search: SearchService,
  ) {}

  /** Current promotion state for an inbox item: draft + gate checklist + the
   *  novelty-based mode suggestion. Creates an empty draft on first open. */
  async getState(
    userId: string,
    conceptId: string,
  ): Promise<PromotionStateDto> {
    const concept = await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const suggestedMode = await this.suggestMode(userId, draft.articulation)
    return {
      conceptId,
      title: concept.title,
      sourceText: concept.sourceText,
      draft: this.toDraftDto(draft),
      checklist: this.checklistFor(draft, draft.mode),
      suggestedMode,
    }
  }

  /** Gate 1 — store the user's own-words articulation. */
  async saveArticulation(
    userId: string,
    conceptId: string,
    body: string,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { articulation: body },
    })
    return this.getState(userId, conceptId)
  }

  /** Set the gate depth (affects the retrieval pass bar and the connect rule). */
  async setMode(
    userId: string,
    conceptId: string,
    mode: GateMode,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { mode },
    })
    return this.getState(userId, conceptId)
  }

  /** Gate 2/4 input — AI-proposed connections (semantic neighbors). These are
   *  suggestions only; nothing is created until the user approves them at commit. */
  async suggestConnections(
    userId: string,
    conceptId: string,
  ): Promise<SuggestedConnection[]> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation) return []

    let matches: Awaited<ReturnType<SearchService['searchArticulations']>>
    try {
      matches = await this.search.searchArticulations(
        userId,
        articulation,
        SUGGESTION_LIMIT * 2,
      )
    } catch (error) {
      // Suggestions ride the optional embeddings seam; degrade to none rather
      // than blocking the gate, but log so a persistently-down provider shows.
      this.logger.warn(
        `Connection suggestions failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }

    // Collapse multiple articulations of the same concept to the best match,
    // and never suggest linking the item to itself.
    const bestByConcept = new Map<string, (typeof matches)[number]>()
    for (const m of matches) {
      if (m.conceptId === conceptId) continue
      const prev = bestByConcept.get(m.conceptId)
      if (!prev || m.similarity > prev.similarity) {
        bestByConcept.set(m.conceptId, m)
      }
    }
    if (bestByConcept.size === 0) return []

    const titles = await this.prisma.concept.findMany({
      where: {
        id: { in: [...bestByConcept.keys()] },
        userId,
        status: { not: ConceptStatus.INBOX },
      },
      select: { id: true, title: true },
    })
    const titleById = new Map(titles.map((c) => [c.id, c.title]))

    return [...bestByConcept.values()]
      .filter((m) => titleById.has(m.conceptId))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, SUGGESTION_LIMIT)
      .map((m) => ({
        targetConceptId: m.conceptId,
        title: titleById.get(m.conceptId) as string,
        similarity: m.similarity,
        snippet: m.body.slice(0, 160),
      }))
  }

  /**
   * Gate 4 — record that the user has reviewed the AI-proposed connections. This
   * is server-recorded (not a client-asserted boolean) so the Validate gate is
   * re-checkable at commit and cannot be self-certified by a direct API caller.
   */
  async markConnectionsReviewed(
    userId: string,
    conceptId: string,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { connectionsReviewed: true },
    })
    return this.getState(userId, conceptId)
  }

  /** Gate 3 setup — generate ONE retrieval question from the articulation. */
  async generateRetrieval(
    userId: string,
    conceptId: string,
  ): Promise<{ question: string }> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation) {
      throw new BadRequestException('Write your articulation first')
    }

    const { system, prompt } = buildQuestionPrompt(articulation)
    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.4,
        maxTokens: 200,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Retrieval question generation failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'Could not generate a retrieval prompt right now — try again shortly',
      )
    }

    const question = parseQuestion(text)
    if (!question) {
      throw new ServiceUnavailableException(
        'Could not generate a retrieval prompt — try again',
      )
    }

    // Storing a (possibly new) question invalidates any prior recall+grade so a
    // user can't pass against an old question.
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: {
        retrievalQuestion: question,
        retrievalResponse: null,
        retrievalScore: null,
        retrievalPassed: false,
      },
    })
    return { question }
  }

  /** Gate 3 — grade the user's recall against their articulation (server-side). */
  async answerRetrieval(
    userId: string,
    conceptId: string,
    response: string,
  ): Promise<{ score: number; passed: boolean; feedback: string | null }> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation || !draft.retrievalQuestion) {
      throw new BadRequestException(
        'Generate a retrieval prompt before answering',
      )
    }

    const { system, prompt } = buildGradePrompt({
      articulation,
      question: draft.retrievalQuestion,
      response,
    })
    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0,
        maxTokens: 200,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Retrieval grading failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'Could not grade your answer right now — try again shortly',
      )
    }

    const grade = parseGrade(text)
    if (!grade) {
      throw new ServiceUnavailableException(
        'Could not grade your answer — try again',
      )
    }

    const passed = isPassingScore(grade.score, draft.mode)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: {
        retrievalResponse: response,
        retrievalScore: grade.score,
        retrievalPassed: passed,
      },
    })
    return { score: grade.score, passed, feedback: grade.feedback }
  }

  /**
   * Commit — re-validate ALL four gates from server-held state and, only if they
   * pass, atomically write the knowledge artifacts and flip INBOX → PERMANENT.
   * Each gate is checked against persisted proof, not the client's word:
   * articulation text, the AI-graded retrieval score (re-scored against the
   * committed mode), the server-validated approved connections, and the draft's
   * `connectionsReviewed` flag. This is the single chokepoint enforcing the
   * epistemic guarantee; there is no other path to PERMANENT anywhere in the app.
   */
  async commit(userId: string, conceptId: string, dto: CommitPromotionDto) {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.prisma.promotionDraft.findUnique({
      where: { conceptId },
    })
    if (!draft) {
      throw new BadRequestException('Start the promotion before committing')
    }

    // A root is "this stands alone" — contradicting it with approved links is an
    // incoherent request; reject it rather than silently ignoring isRoot.
    if (dto.isRoot && dto.connections.length > 0) {
      throw new BadRequestException(
        'A new root has no connections — uncheck root or remove the links',
      )
    }

    // Validate every approved connection: owned, earned (non-INBOX), not a self
    // link, and de-duplicated. AI suggestions never auto-apply — only what the
    // user listed here is created.
    const targets = new Map<string, string | undefined>()
    for (const c of dto.connections) {
      if (c.targetConceptId === conceptId) {
        throw new BadRequestException('A concept cannot link to itself')
      }
      await this.concepts.assertOwnedNonInbox(userId, c.targetConceptId)
      if (!targets.has(c.targetConceptId)) {
        targets.set(c.targetConceptId, c.relation)
      }
    }

    const decision: ConnectionDecision = {
      connectionCount: targets.size,
      isRoot: dto.isRoot,
      // Gate 4 is server-authoritative: it comes from the persisted draft flag
      // (set when the user reviewed suggestions), never from the request body.
      connectionsReviewed: draft.connectionsReviewed,
      mode: dto.mode,
    }
    // Re-derive the retrieval pass against the COMMITTED mode (DEEP demands a
    // higher score than QUICK), so a QUICK pass can't be smuggled into a DEEP save.
    const retrievalPassed =
      draft.retrievalScore != null &&
      isPassingScore(draft.retrievalScore, dto.mode)
    const checklist = evaluateGates(
      { articulation: draft.articulation, retrievalPassed },
      decision,
    )
    if (!checklist.ready) {
      throw new BadRequestException({
        message: 'Promotion blocked: not all proof-of-learning gates are met',
        gates: checklist,
      })
    }

    const articulationBody = (draft.articulation as string).trim()
    const cognitiveState: CognitiveState = checklist.cognitiveState

    const articulationId = await this.prisma.$transaction(async (tx) => {
      // Delete-as-gate: the draft's `@unique` conceptId serializes concurrent
      // commits. The first tx to acquire the row deletes it; a racing second
      // commit blocks, then sees 0 rows and aborts before writing anything —
      // preventing duplicate artifacts or a double promotion.
      const claimed = await tx.promotionDraft.deleteMany({
        where: { conceptId, userId },
      })
      if (claimed.count === 0) {
        throw new ConflictException('This item has already been promoted')
      }

      const articulation = await tx.articulation.create({
        data: { conceptId, userId, body: articulationBody },
      })
      await tx.retrievalEvent.create({
        data: {
          conceptId,
          userId,
          question: draft.retrievalQuestion,
          response: draft.retrievalResponse,
          score: draft.retrievalScore,
        },
      })
      for (const [targetConceptId, relation] of targets) {
        try {
          await tx.link.create({
            data: {
              sourceConceptId: conceptId,
              targetConceptId,
              relation,
              status: LinkStatus.CONFIRMED,
              userId,
            },
          })
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException('That link already exists')
          }
          throw error
        }
      }
      await tx.concept.update({
        where: { id: conceptId },
        data: {
          status: ConceptStatus.PERMANENT,
          cognitiveState,
          gateMode: dto.mode,
        },
      })
      return articulation.id
    })

    // Embed the new articulation so the now-permanent concept is searchable.
    // Best-effort (SearchService swallows failures) and outside the tx.
    await this.search.indexArticulation(articulationId, articulationBody)

    return this.concepts.findOne(userId, conceptId)
  }

  /** Abandon an in-progress promotion, discarding the staged inputs. */
  async abandon(userId: string, conceptId: string): Promise<void> {
    await this.requireInboxConcept(userId, conceptId)
    await this.prisma.promotionDraft.deleteMany({
      where: { conceptId, userId },
    })
  }

  /** Loads an inbox-status concept the user owns, or throws NotFound. Mirrors the
   *  intake interrogator's guard — promotion only applies to inbox items. */
  private async requireInboxConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId, status: ConceptStatus.INBOX },
      select: { id: true, title: true, sourceText: true },
    })
    if (!concept) throw new NotFoundException('Inbox item not found')
    return concept
  }

  /** Returns the draft for an inbox concept, creating an empty one if needed. */
  private async ensureDraft(userId: string, conceptId: string) {
    const existing = await this.prisma.promotionDraft.findUnique({
      where: { conceptId },
    })
    if (existing) return existing
    return this.prisma.promotionDraft.create({
      data: { conceptId, userId },
    })
  }

  private async suggestMode(
    userId: string,
    articulation: string | null,
  ): Promise<GateMode> {
    const text = articulation?.trim()
    if (!text) return GateMode.QUICK
    try {
      const matches = await this.search.searchArticulations(userId, text, 1)
      const top = matches[0]?.similarity ?? 0
      // Novel material (far from the existing graph) → suggest the deeper gate.
      return top < NOVELTY_THRESHOLD ? GateMode.DEEP : GateMode.QUICK
    } catch {
      return GateMode.QUICK
    }
  }

  private checklistFor(
    draft: {
      articulation: string | null
      connectionsReviewed: boolean
      retrievalScore: number | null
    },
    mode: GateMode,
  ): GateChecklist {
    // Pre-commit checklist is advisory for `connect` (which approved links are
    // chosen at commit, so we show it with count 0). `validate` is real here —
    // it reflects the server-recorded review flag. The authoritative check for
    // all gates happens in commit().
    const retrievalPassed =
      draft.retrievalScore != null && isPassingScore(draft.retrievalScore, mode)
    return evaluateGates(
      { articulation: draft.articulation, retrievalPassed },
      {
        connectionCount: 0,
        isRoot: false,
        connectionsReviewed: draft.connectionsReviewed,
        mode,
      },
    )
  }

  private toDraftDto(draft: {
    conceptId: string
    mode: GateMode
    articulation: string | null
    connectionsReviewed: boolean
    retrievalQuestion: string | null
    retrievalResponse: string | null
    retrievalScore: number | null
  }): PromotionDraftDto {
    return {
      conceptId: draft.conceptId,
      mode: draft.mode,
      articulation: draft.articulation,
      connectionsReviewed: draft.connectionsReviewed,
      retrievalQuestion: draft.retrievalQuestion,
      retrievalResponse: draft.retrievalResponse,
      retrievalScore: draft.retrievalScore,
    }
  }
}
