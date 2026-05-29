import type { Note } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateNoteDto } from './dto/create-note.dto'

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForUser(userId: string): Promise<Note[]> {
    return this.prisma.note.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  create(userId: string, dto: CreateNoteDto): Promise<Note> {
    return this.prisma.note.create({
      data: {
        title: dto.title,
        body: dto.body ?? '',
        userId,
      },
    })
  }
}
