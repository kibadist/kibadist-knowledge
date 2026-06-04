import { WaitlistService } from './waitlist.service'

function makeService() {
  const prisma = {
    waitlistEntry: {
      upsert: jest.fn(),
    },
  }
  const service = new WaitlistService(prisma as never)
  return { service, prisma }
}

describe('WaitlistService.join', () => {
  it('creates an entry for a new email and returns { ok: true }', async () => {
    const { service, prisma } = makeService()
    prisma.waitlistEntry.upsert.mockResolvedValue({ id: 'uuid-1', email: 'a@example.com', source: null })

    const result = await service.join({ email: 'a@example.com' })

    expect(result).toEqual({ ok: true })
    expect(prisma.waitlistEntry.upsert).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
      create: { email: 'a@example.com', source: undefined },
      update: {},
    })
  })

  it('is idempotent: returns { ok: true } on duplicate email (upsert no-ops)', async () => {
    const { service, prisma } = makeService()
    // Simulate duplicate: upsert returns the existing row unchanged
    prisma.waitlistEntry.upsert.mockResolvedValue({ id: 'uuid-1', email: 'dup@example.com', source: null })

    const first = await service.join({ email: 'dup@example.com' })
    const second = await service.join({ email: 'dup@example.com' })

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(prisma.waitlistEntry.upsert).toHaveBeenCalledTimes(2)
  })

  it('normalizes email casing/whitespace so variants stay one row', async () => {
    const { service, prisma } = makeService()
    prisma.waitlistEntry.upsert.mockResolvedValue({ id: 'uuid-3', email: 'c@example.com', source: null })

    const result = await service.join({ email: '  C@Example.COM ' })

    expect(result).toEqual({ ok: true })
    expect(prisma.waitlistEntry.upsert).toHaveBeenCalledWith({
      where: { email: 'c@example.com' },
      create: { email: 'c@example.com', source: undefined },
      update: {},
    })
  })

  it('passes the source field through when provided', async () => {
    const { service, prisma } = makeService()
    prisma.waitlistEntry.upsert.mockResolvedValue({ id: 'uuid-2', email: 'b@example.com', source: 'landing' })

    const result = await service.join({ email: 'b@example.com', source: 'landing' })

    expect(result).toEqual({ ok: true })
    expect(prisma.waitlistEntry.upsert).toHaveBeenCalledWith({
      where: { email: 'b@example.com' },
      create: { email: 'b@example.com', source: 'landing' },
      update: {},
    })
  })
})
