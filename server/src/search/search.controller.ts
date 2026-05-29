import { Body, Controller, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SearchDto } from './dto/search.dto'
import { SearchService } from './search.service'

// Protected by the global JwtAuthGuard. Semantic similarity search over the
// current user's articulations.
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

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
