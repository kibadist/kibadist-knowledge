import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { SearchDto } from './dto/search.dto'
import { SearchService } from './search.service'

// Protected by the global JwtAuthGuard. Semantic similarity search over the
// current user's articulations.
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Throttle(AI_THROTTLE)
  @Post()
  async search(@CurrentUser() user: AuthUser, @Body() dto: SearchDto) {
    const matches = await this.searchService.searchArticulations(
      user.userId,
      dto.query,
      dto.limit,
    )
    return { query: dto.query, count: matches.length, matches }
  }
}
