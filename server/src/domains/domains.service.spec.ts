import { Generator } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { DomainsService } from './domains.service'

function makeService() {
  const prisma = {
    domain: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    concept: {
      findFirst: jest.fn(),
    },
    conceptDomain: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const service = new DomainsService(prisma as never, concepts as never)
  return { service, prisma, concepts }
}

describe('DomainsService.tag (multi-domain membership)', () => {
  it('tags one concept into MULTIPLE domains — the join is the whole point', async () => {
    const { service, prisma } = makeService()
    // The concept lives in ws1; both domains are in ws1.
    prisma.concept.findFirst.mockResolvedValue({ workspaceId: 'ws1' })
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.conceptDomain.upsert.mockImplementation(
      ({ create }: { create: unknown }) => Promise.resolve(create),
    )

    const a = await service.tag('u1', 'c1', 'd1')
    const b = await service.tag('u1', 'c1', 'd2')

    // Both memberships persisted for the SAME concept — not re-parented.
    expect(prisma.conceptDomain.upsert).toHaveBeenCalledTimes(2)
    expect(a).toMatchObject({
      conceptId: 'c1',
      domainId: 'd1',
      createdBy: Generator.USER,
      userValidated: true,
    })
    expect(b).toMatchObject({ conceptId: 'c1', domainId: 'd2' })
  })

  it('records a manual tag as USER + userValidated (provenance)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ workspaceId: 'ws1' })
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.conceptDomain.upsert.mockResolvedValue({ conceptId: 'c1' })

    await service.tag('u1', 'c1', 'd1', 0.5)

    expect(prisma.conceptDomain.upsert).toHaveBeenCalledWith({
      where: { conceptId_domainId: { conceptId: 'c1', domainId: 'd1' } },
      create: {
        conceptId: 'c1',
        domainId: 'd1',
        confidence: 0.5,
        createdBy: Generator.USER,
        userValidated: true,
      },
      update: {
        createdBy: Generator.USER,
        userValidated: true,
        confidence: 0.5,
      },
    })
  })

  it('refuses to tag a concept into a domain from another workspace', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ workspaceId: 'ws1' })
    // assertDomainInWorkspace(domain, 'ws1') finds nothing → cross-workspace.
    prisma.domain.findFirst.mockResolvedValue(null)

    await expect(service.tag('u1', 'c1', 'd-other')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.conceptDomain.upsert).not.toHaveBeenCalled()
  })
})

describe('DomainsService.validate', () => {
  it('flips userValidated true while PRESERVING createdBy provenance', async () => {
    const { service, prisma } = makeService()
    prisma.conceptDomain.findUnique.mockResolvedValue({
      conceptId: 'c1',
      domainId: 'd1',
      createdBy: Generator.AI,
      userValidated: false,
    })
    prisma.conceptDomain.update.mockResolvedValue({
      createdBy: Generator.AI,
      userValidated: true,
    })

    const result = await service.validate('u1', 'c1', 'd1')

    // Only userValidated is written — the AI provenance is never overwritten.
    expect(prisma.conceptDomain.update).toHaveBeenCalledWith({
      where: { conceptId_domainId: { conceptId: 'c1', domainId: 'd1' } },
      data: { userValidated: true },
    })
    expect(result).toMatchObject({
      createdBy: Generator.AI,
      userValidated: true,
    })
  })

  it('404s when the membership does not exist', async () => {
    const { service, prisma } = makeService()
    prisma.conceptDomain.findUnique.mockResolvedValue(null)

    await expect(service.validate('u1', 'c1', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.conceptDomain.update).not.toHaveBeenCalled()
  })
})

describe('DomainsService.remove', () => {
  it('deletes the domain only — concepts are left intact (cascade orphans memberships)', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1', workspaceId: 'ws1' })
    prisma.domain.delete.mockResolvedValue({ id: 'd1' })

    await service.remove('u1', 'd1')

    // The only delete is on the domain; the DB cascade handles concept_domain.
    expect(prisma.domain.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })

  it('rejects deleting a domain the user does not own', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue(null)

    await expect(service.remove('u1', 'd-other')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.domain.delete).not.toHaveBeenCalled()
  })
})
