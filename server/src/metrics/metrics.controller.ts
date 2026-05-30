import { Controller, Get } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { MetricsService } from './metrics.service'

/**
 * Anti-Vanity Metrics (DET-200). A read-only surface whose numbers go up only
 * when the user actually understands more — retention and synthesis, never
 * streaks or note/concept volume. See {@link MetricsService} for the stance.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** The current user's understanding metrics, computed from existing rows. */
  @Get()
  forUser(@CurrentUser() user: AuthUser) {
    return this.metrics.forUser(user.userId)
  }
}
