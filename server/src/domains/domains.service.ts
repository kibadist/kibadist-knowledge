import { type ConceptDomain, type Domain, Generator } from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateDomainDto } from './dto/create-domain.dto'
import type { UpdateDomainDto } from './dto/update-domain.dto'

/** A membership joined with its domain — what the concept view renders. */
export type ConceptDomainWithDomain = ConceptDomain & { domain: Domain }

/**
 * Domains (DET-234): semantic regions of a workspace, and the ConceptDomain
 * membership that lets a concept live in several at once. Two responsibilities:
 *
 *  1. Domain CRUD, always workspace-scoped. The owning workspace id is resolved
 *     and ownership-checked by the controller (via WorkspacesService); this
 *     service trusts that id for creates/lists and re-checks ownership by
 *     joining through `workspace.ownerUserId` for mutations by domain id.
 *  2. Tagging concepts into domains. A manual tag is USER + userValidated; an
 *     AI suggestion (written by {@link DomainSuggestionService}) is AI +
 *     unvalidated until the user accepts it.
 *
 * Hard boundary (DET-231/189): a domain membership is ORGANIZATIONAL METADATA,
 * never knowledge. Nothing here writes an Articulation, moves a concept's
 * status, or touches CognitiveState — the Proof-of-Learning gate is untouched.
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
  ) {}

  /** Domains in a workspace, oldest first. */
  findAllForWorkspace(workspaceId: string): Promise<Domain[]> {
    return this.prisma.domain.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateDomainDto,
  ): Promise<Domain> {
    // A parent, if given, must be a domain in THIS workspace.
    if (dto.parentDomainId) {
      await this.assertDomainInWorkspace(dto.parentDomainId, workspaceId)
    }
    return this.prisma.domain.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        parentDomainId: dto.parentDomainId ?? null,
        color: dto.color ?? null,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateDomainDto,
  ): Promise<Domain> {
    const domain = await this.assertOwnedDomain(userId, id)

    // Re-parenting: the new parent must be in the same workspace, and a domain
    // can never be its own parent (a trivial cycle). Deeper cycle prevention is
    // deferred — nesting is shallow in practice and the UI doesn't expose it yet.
    if (dto.parentDomainId !== undefined && dto.parentDomainId !== null) {
      if (dto.parentDomainId === id) {
        throw new BadRequestException('A domain cannot be its own parent')
      }
      await this.assertDomainInWorkspace(dto.parentDomainId, domain.workspaceId)
    }

    return this.prisma.domain.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        // `null` un-nests; `undefined` leaves the parent unchanged.
        parentDomainId: dto.parentDomainId,
        color: dto.color,
      },
    })
  }

  /**
   * Delete a domain. Its ConceptDomain rows cascade away (the memberships are
   * orphaned), but the concepts themselves are untouched — a domain is a region,
   * not a container. DET-234 acceptance: "deleting a domain leaves concepts intact".
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwnedDomain(userId, id)
    await this.prisma.domain.delete({ where: { id } })
  }

  // ---- Concept ⇄ Domain membership ----------------------------------------

  /** The domains a concept belongs to (joined), provenance included. */
  async listForConcept(
    userId: string,
    conceptId: string,
  ): Promise<ConceptDomainWithDomain[]> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    return this.prisma.conceptDomain.findMany({
      where: { conceptId },
      include: { domain: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  /**
   * Tag a concept into a domain by hand: createdBy USER, userValidated true (the
   * user is asserting the membership). Idempotent via upsert on the composite PK
   * — re-tagging promotes a prior AI suggestion to a validated user membership.
   * Both the concept (non-inbox, owned) and the domain (same workspace) are
   * checked, so a concept can never be tagged into another workspace's domain.
   */
  async tag(
    userId: string,
    conceptId: string,
    domainId: string,
    confidence?: number,
  ): Promise<ConceptDomain> {
    await this.assertConceptAndDomainAligned(userId, conceptId, domainId)
    return this.prisma.conceptDomain.upsert({
      where: { conceptId_domainId: { conceptId, domainId } },
      create: {
        conceptId,
        domainId,
        confidence: confidence ?? null,
        createdBy: Generator.USER,
        userValidated: true,
      },
      update: {
        createdBy: Generator.USER,
        userValidated: true,
        ...(confidence === undefined ? {} : { confidence }),
      },
    })
  }

  /** Remove a concept↔domain membership. No-op-safe if it doesn't exist. */
  async untag(
    userId: string,
    conceptId: string,
    domainId: string,
  ): Promise<void> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    await this.prisma.conceptDomain.deleteMany({
      where: { conceptId, domainId },
    })
  }

  /**
   * Accept an AI-suggested membership: flip `userValidated` true while preserving
   * `createdBy` (the provenance that it originated as an AI proposal). This is the
   * domain analogue of confirming a SUGGESTED Link.
   */
  async validate(
    userId: string,
    conceptId: string,
    domainId: string,
  ): Promise<ConceptDomain> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    const membership = await this.prisma.conceptDomain.findUnique({
      where: { conceptId_domainId: { conceptId, domainId } },
    })
    if (!membership) throw new NotFoundException('Domain membership not found')
    return this.prisma.conceptDomain.update({
      where: { conceptId_domainId: { conceptId, domainId } },
      data: { userValidated: true },
    })
  }

  // ---- Ownership helpers ---------------------------------------------------

  /**
   * Load a domain and assert the user owns its workspace. Ownership is checked by
   * joining through `workspace.ownerUserId` — never by domain id alone — so one
   * user can't mutate another's domain. Returns the row for the caller to reuse.
   */
  async assertOwnedDomain(userId: string, id: string): Promise<Domain> {
    const domain = await this.prisma.domain.findFirst({
      where: { id, workspace: { ownerUserId: userId } },
    })
    if (!domain) throw new NotFoundException('Domain not found')
    return domain
  }

  /** Assert a domain exists in a specific workspace (for parent/tag alignment). */
  private async assertDomainInWorkspace(
    domainId: string,
    workspaceId: string,
  ): Promise<void> {
    const found = await this.prisma.domain.findFirst({
      where: { id: domainId, workspaceId },
      select: { id: true },
    })
    if (!found) {
      throw new NotFoundException('Domain not found in this workspace')
    }
  }

  /**
   * Assert the concept (owned, non-inbox) and the domain live in the SAME
   * workspace, returning that workspace id. This is the invariant that keeps a
   * concept from being tagged into a domain belonging to a different world.
   */
  private async assertConceptAndDomainAligned(
    userId: string,
    conceptId: string,
    domainId: string,
  ): Promise<string> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { workspaceId: true },
    })
    if (!concept) throw new NotFoundException('Concept not found')
    await this.assertDomainInWorkspace(domainId, concept.workspaceId)
    return concept.workspaceId
  }
}
