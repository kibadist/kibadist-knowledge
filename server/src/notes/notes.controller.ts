import { Body, Controller, Get, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { CreateNoteDto } from './dto/create-note.dto'
import { NotesService } from './notes.service'

// Protected by the global JwtAuthGuard — no @Public() here.
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notesService.findAllForUser(user.userId)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto) {
    return this.notesService.create(user.userId, dto)
  }
}
