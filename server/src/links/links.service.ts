import { type Link, Prisma } from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
  ) {}

  /** Lists the user's edges, optionally only those touching one concept. */
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

    try {
      return await this.prisma.link.create({
        data: {
          sourceConceptId: dto.sourceConceptId,
          targetConceptId: dto.targetConceptId,
          relation: dto.relation,
          status: dto.status,
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
  }

  async update(userId: string, id: string, dto: UpdateLinkDto): Promise<Link> {
    await this.assertOwned(userId, id)
    return this.prisma.link.update({
      where: { id },
      data: { status: dto.status, relation: dto.relation },
    })
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.link.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Link not found')
  }
}
