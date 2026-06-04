import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { JoinWaitlistDto } from './dto/join-waitlist.dto'

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  async join(dto: JoinWaitlistDto): Promise<{ ok: true }> {
    // Normalize so casing variants of the same address stay one row —
    // keeps the upsert genuinely idempotent (Postgres unique is case-sensitive).
    const email = dto.email.trim().toLowerCase()
    await this.prisma.waitlistEntry.upsert({
      where: { email },
      create: { email, source: dto.source },
      update: {},
    })
    return { ok: true }
  }
}
