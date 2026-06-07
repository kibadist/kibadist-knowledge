import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { ConceptLibraryService } from './concept-library.service'

/**
 * The Concept Library (DET-211). Surfaces a captured article as classified,
 * section-sized chunks and the candidate concepts within them. Everything here is
 * SCAFFOLD — nothing in this controller can create or promote an earned Concept.
 * Promotion stays exclusively in the Proof-of-Learning gate (DET-189).
 */
@Controller()
export class ConceptLibraryController {
  constructor(private readonly library: ConceptLibraryService) {}

  /** Read the persisted library (generates on first access). */
  @Get('inbox/:id/concept-library')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.library(user.userId, id)
  }

  /** Rebuild the library from the source (idempotent). AI-backed → throttled. */
  @Throttle(AI_THROTTLE)
  @Post('inbox/:id/concept-library/regenerate')
  regenerate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.generate(user.userId, id)
  }

  /** Dismiss a candidate so it no longer surfaces in the library. */
  @Post('concept-candidates/:id/dismiss')
  @HttpCode(204)
  async dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.library.dismiss(user.userId, id)
  }

  /** Restore a dismissed candidate so it surfaces in the library again (DET-309). */
  @Post('concept-candidates/:id/restore')
  @HttpCode(204)
  async restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.library.restore(user.userId, id)
  }
}
