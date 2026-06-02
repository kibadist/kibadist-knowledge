import { type ConceptDomain, Generator, Prisma } from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  buildDomainSuggestionPrompt,
  type DomainCandidate,
  MAX_DOMAINS,
  parseDomainSuggestions,
} from './domain-suggestion.prompt'

/**
 * AI Domain Suggestion (DET-234). Given a concept's latest compression and the
 * workspace's existing domains, asks the model which domains the concept belongs
 * to and PERSISTS each as a `ConceptDomain` row with createdBy AI,
 * userValidated false.
 *
 * HARD BOUNDARY (DET-231/189): a suggestion is METADATA, NOT KNOWLEDGE — exactly
 * like a SUGGESTED Link. It never promotes the concept, never writes an
 * Articulation, never touches CognitiveState. The only thing it writes is the
 * unvalidated membership the user then accepts (validate) or removes (untag).
 *
 * Provenance is preserved: a domain the user has ALREADY decided on (any existing
 * ConceptDomain row, validated or not) is left untouched, so a re-run never
 * clobbers a user's validation or re-proposes a membership they removed-then-
 * the row is simply skipped on the composite PK. Best-effort: failures log and
 * return [] so a flaky AI call never corrupts state or blocks the user.
 */
@Injectable()
export class DomainSuggestionService {
  private readonly logger = new Logger(DomainSuggestionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly concepts: ConceptsService,
  ) {}

  /**
   * Suggest + persist domain memberships for a concept. Returns the newly
   * created (AI, unvalidated) memberships; an empty array if the concept has no
   * articulation, the workspace has no domains, or nothing new was proposed.
   */
  async suggestForConcept(
    userId: string,
    conceptId: string,
  ): Promise<ConceptDomain[]> {
    try {
      await this.concepts.assertOwnedNonInbox(userId, conceptId)

      const concept = await this.prisma.concept.findFirst({
        where: { id: conceptId, userId },
        select: { title: true, workspaceId: true },
      })
      if (!concept) return []

      const latest = await this.prisma.articulation.findFirst({
        where: { conceptId, userId },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      })
      const articulation = latest?.body?.trim()
      if (!articulation) return []

      // Existing domains in this workspace, capped for the prompt budget.
      const domains = await this.prisma.domain.findMany({
        where: { workspaceId: concept.workspaceId },
        orderBy: { createdAt: 'asc' },
        take: MAX_DOMAINS,
        select: { id: true, name: true, description: true },
      })
      if (domains.length === 0) return []

      const candidates: DomainCandidate[] = domains.map((d, index) => ({
        index,
        name: d.name,
        description: d.description,
      }))

      const { system, prompt } = buildDomainSuggestionPrompt({
        concept: { title: concept.title, articulation },
        domains: candidates,
      })
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0,
        maxTokens: 600,
      })
      const suggestions = parseDomainSuggestions(result.text, domains.length)
      if (suggestions.length === 0) return []

      const created: ConceptDomain[] = []
      for (const suggestion of suggestions) {
        const domain = domains[suggestion.index]
        if (!domain) continue
        try {
          // create() (not upsert) so an existing membership — a user tag, a prior
          // suggestion, or one the user validated — is never overwritten. The
          // composite PK makes a duplicate a P2002 we skip.
          const membership = await this.prisma.conceptDomain.create({
            data: {
              conceptId,
              domainId: domain.id,
              confidence: suggestion.confidence,
              createdBy: Generator.AI,
              userValidated: false,
            },
          })
          created.push(membership)
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            continue
          }
          throw error
        }
      }
      return created
    } catch (error) {
      this.logger.warn(
        `Domain suggestion failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }
}
