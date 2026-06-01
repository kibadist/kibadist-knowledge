import { Body, Controller, Get, Put } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SavePositionsDto } from './dto/save-positions.dto'
import { GraphService } from './graph.service'

// The Concept Graph / Overview Map (DET-230). The earned layer derived live from
// concepts + links, plus the user's hand-placed node positions.
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get()
  getGraph(@CurrentUser() user: AuthUser) {
    return this.graphService.getGraph(user.userId)
  }

  // Persist the user's manual node placements. Layout re-runs never destroy these.
  @Put('positions')
  savePositions(@CurrentUser() user: AuthUser, @Body() dto: SavePositionsDto) {
    return this.graphService.savePositions(user.userId, dto)
  }
}
