import {
  type Link,
  LinkRelation,
  LinkStatus,
  Prisma,
  QuestionActor,
  StateTrigger,
} from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateLinkDto } from './dto/create-link.dto'
import type { UpdateLinkDto } from './dto/update-link.dto'

const linkConceptInclude = {
  sourceConcept: { select: { id: true, title: true } },
  targetConcept: { select: { id: true, title: true } },
} as const

@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly conceptState: ConceptStateService,
  ) {}

  /**
   * Lists the user's links, optionally only those touching one concept. NOTE:
   * this returns ALL statuses (SUGGESTED/CONFIRMED/REJECTED), not just edges —
   * the caller distinguishes them by `status`. Only CONFIRMED links are graph
   * edges; SUGGESTED/REJECTED are proposals/dismissals (DET-191).
   */
  findAllForUser(userId: string, conceptId?: string) {
    return this.prisma.link.findMany({
      where: {
        userId,
        ...(conceptId
          ? {
              OR: [
                { sourceConceptId: conceptId },
                { targetConceptId: conceptId },
              ],
            }
          : {}),
      },
      include: linkConceptInclude,
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(userId: string, dto: CreateLinkDto) {
    if (dto.sourceConceptId === dto.targetConceptId) {
      throw new BadRequestException('A concept cannot link to itself')
    }
    // Both endpoints must belong to the user and be earned concepts — inbox
    // items have no graph links (DET-187).
    await this.concepts.assertOwnedNonInbox(userId, dto.sourceConceptId)
    await this.concepts.assertOwnedNonInbox(userId, dto.targetConceptId)

    let link: Link & {
      sourceConcept: { id: string; title: string }
      targetConcept: { id: string; title: string }
    }
    try {
      link = await this.prisma.link.create({
        data: {
          sourceConceptId: dto.sourceConceptId,
          targetConceptId: dto.targetConceptId,
          relation: dto.relation,
          relationKind: dto.relationKind,
          rationale: dto.rationale,
          status: dto.status,
          // A manually-created link is the user's own edge (DET-191).
          proposedBy: QuestionActor.USER,
          userId,
        },
        include: linkConceptInclude,
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

    // A confirmed contradiction puts the TARGET into CONTESTED (DET-191/194).
    if (link.status === LinkStatus.CONFIRMED) {
      await this.maybeContest(userId, link)
    }
    return link
  }

  async update(userId: string, id: string, dto: UpdateLinkDto): Promise<Link> {
    await this.assertOwned(userId, id)
    const link = await this.prisma.link.update({
      where: { id },
      data: {
        status: dto.status,
        relation: dto.relation,
        relationKind: dto.relationKind,
      },
    })
    // Confirming an existing proposal (e.g. SUGGESTED → CONFIRMED) that is a
    // contradiction contests the target (DET-191/194).
    if (dto.status === LinkStatus.CONFIRMED) {
      await this.maybeContest(userId, link)
    }
    return link
  }

  /**
   * Reject a proposed link between two concepts (DET-191): persist a REJECTED
   * row so the Connector remembers the dismissal and never re-surfaces the pair.
   * A REJECTED row is NOT a graph edge. Upserts so a re-rejection is idempotent.
   */
  async reject(
    userId: string,
    sourceConceptId: string,
    targetConceptId: string,
  ): Promise<Link> {
    const existing = await this.prisma.link.findFirst({
      where: { userId, sourceConceptId, targetConceptId },
      select: { id: true },
    })
    if (existing) {
      return this.prisma.link.update({
        where: { id: existing.id },
        data: { status: LinkStatus.REJECTED },
      })
    }
    // No prior proposal — record the dismissal so it's remembered. Endpoints
    // must still be owned, earned concepts (DET-187).
    await this.concepts.assertOwnedNonInbox(userId, sourceConceptId)
    await this.concepts.assertOwnedNonInbox(userId, targetConceptId)
    return this.prisma.link.create({
      data: {
        sourceConceptId,
        targetConceptId,
        status: LinkStatus.REJECTED,
        proposedBy: QuestionActor.USER,
        userId,
      },
    })
  }

  /**
   * When a link is CONFIRMED and typed CONTRADICTION, drive the TARGET concept to
   * CONTESTED through the state machine (DET-194). Best-effort: an illegal move
   * (e.g. the target is ARCHIVED) is logged, never thrown — confirming the edge
   * must succeed regardless of the target's lifecycle.
   */
  private async maybeContest(
    userId: string,
    link: {
      relationKind: LinkRelation | null
      sourceConceptId: string
      targetConceptId: string
    },
  ): Promise<void> {
    if (link.relationKind !== LinkRelation.CONTRADICTION) return
    try {
      await this.conceptState.transition({
        conceptId: link.targetConceptId,
        userId,
        to: 'CONTESTED',
        trigger: StateTrigger.CONTRADICTION,
        note: `contradicted by ${link.sourceConceptId}`,
      })
    } catch (error) {
      this.logger.warn(
        `Could not contest target ${link.targetConceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.link.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Link not found')
  }
}
