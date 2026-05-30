import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { CreateLinkDto } from './dto/create-link.dto'
import { RejectLinkDto } from './dto/reject-link.dto'
import { UpdateLinkDto } from './dto/update-link.dto'
import { LinksService } from './links.service'

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('conceptId') conceptId?: string) {
    return this.linksService.findAllForUser(user.userId, conceptId)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLinkDto) {
    return this.linksService.create(user.userId, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLinkDto,
  ) {
    return this.linksService.update(user.userId, id, dto)
  }

  // Dismiss a proposed connection (DET-191): persists a REJECTED row so the
  // Connector remembers the rejection and never re-surfaces the pair.
  @Post('reject')
  reject(@CurrentUser() user: AuthUser, @Body() dto: RejectLinkDto) {
    return this.linksService.reject(
      user.userId,
      dto.sourceConceptId,
      dto.targetConceptId,
    )
  }
}
