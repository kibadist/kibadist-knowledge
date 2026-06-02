import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { DomainSuggestionService } from './domain-suggestion.service'
import { DomainsService } from './domains.service'
import { TagConceptDomainDto } from './dto/tag-concept-domain.dto'

// Concept ⇄ Domain membership (DET-234), nested under a concept. A concept can
// be tagged into several domains and shows them; AI suggestions arrive
// unvalidated and become real only when the user accepts (validate) or removes
// them. Membership is metadata — none of these routes touch the gate (DET-189).
@Controller('concepts/:conceptId/domains')
export class ConceptDomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly suggestions: DomainSuggestionService,
  ) {}

  // The concept's domains (joined), provenance included so the UI can render
  // AI-suggested vs user-validated memberships distinctly.
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('conceptId') conceptId: string) {
    return this.domains.listForConcept(user.userId, conceptId)
  }

  // Manually tag the concept into a domain: USER + userValidated true.
  @Post()
  tag(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: TagConceptDomainDto,
  ) {
    return this.domains.tag(
      user.userId,
      conceptId,
      dto.domainId,
      dto.confidence,
    )
  }

  // AI domain suggestion (paid OpenAI path → strict `ai` throttler). Persists
  // proposals as createdBy AI, userValidated false; best-effort (never 500s).
  @Throttle(AI_THROTTLE)
  @Post('suggest')
  suggest(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.suggestions.suggestForConcept(user.userId, conceptId)
  }

  // Accept an AI-suggested membership: flip userValidated true (provenance kept).
  @Post(':domainId/validate')
  validate(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.validate(user.userId, conceptId, domainId)
  }

  // Remove a membership (a user tag or a rejected suggestion).
  @Delete(':domainId')
  @HttpCode(204)
  async untag(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Param('domainId') domainId: string,
  ) {
    await this.domains.untag(user.userId, conceptId, domainId)
  }
}
