import type { User } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    })
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } })
  }

  create(data: {
    email: string
    name?: string | null
    passwordHash: string
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email.trim().toLowerCase(),
        name: data.name ?? null,
        passwordHash: data.passwordHash,
      },
    })
  }
}
