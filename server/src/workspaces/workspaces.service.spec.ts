import { ConflictException, NotFoundException } from '@nestjs/common'

import { WorkspacesService } from './workspaces.service'

function makeService() {
  const prisma = {
    workspace: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  }
  const service = new WorkspacesService(prisma as never)
  return { service, prisma }
}

describe('WorkspacesService.resolveActiveWorkspaceId', () => {
  it('returns the requested workspace when it belongs to the user', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue({ id: 'ws-req' })

    const id = await service.resolveActiveWorkspaceId('u1', 'ws-req')

    expect(id).toBe('ws-req')
    // Ownership is checked by (id, ownerUserId) — never id alone.
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: { id: 'ws-req', ownerUserId: 'u1' },
      select: { id: true },
    })
  })

  it('rejects a requested workspace the user does not own', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue(null)

    await expect(
      service.resolveActiveWorkspaceId('u1', 'someone-elses'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.workspace.create).not.toHaveBeenCalled()
  })

  it('falls back to the existing default (earliest) workspace when none is requested', async () => {
    const { service, prisma } = makeService()
    // ensureDefaultWorkspace finds the earliest existing workspace.
    prisma.workspace.findFirst.mockResolvedValue({
      id: 'ws-default',
      ownerUserId: 'u1',
    })

    const id = await service.resolveActiveWorkspaceId('u1')

    expect(id).toBe('ws-default')
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: { ownerUserId: 'u1' },
      orderBy: { createdAt: 'asc' },
    })
    // It already existed — no new workspace minted.
    expect(prisma.workspace.create).not.toHaveBeenCalled()
  })
})

describe('WorkspacesService.ensureDefaultWorkspace', () => {
  it('returns the existing workspace without creating one', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue({ id: 'ws1' })

    const ws = await service.ensureDefaultWorkspace('u1')

    expect(ws).toEqual({ id: 'ws1' })
    expect(prisma.workspace.create).not.toHaveBeenCalled()
  })

  it('provisions a "My Knowledge" workspace when the user has none', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue(null)
    prisma.workspace.create.mockResolvedValue({ id: 'ws-new' })

    const ws = await service.ensureDefaultWorkspace('u1')

    expect(ws).toEqual({ id: 'ws-new' })
    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: { name: 'My Knowledge', ownerUserId: 'u1' },
    })
  })
})

describe('WorkspacesService.remove', () => {
  it("refuses to delete a user's only workspace", async () => {
    const { service, prisma } = makeService()
    // assertOwned passes.
    prisma.workspace.findFirst.mockResolvedValue({ id: 'ws1' })
    prisma.workspace.count.mockResolvedValue(1)

    await expect(service.remove('u1', 'ws1')).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(prisma.workspace.delete).not.toHaveBeenCalled()
  })

  it('deletes a workspace when the user has more than one', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue({ id: 'ws1' })
    prisma.workspace.count.mockResolvedValue(2)
    prisma.workspace.delete.mockResolvedValue({ id: 'ws1' })

    await service.remove('u1', 'ws1')

    expect(prisma.workspace.delete).toHaveBeenCalledWith({
      where: { id: 'ws1' },
    })
  })

  it('rejects deleting a workspace the user does not own', async () => {
    const { service, prisma } = makeService()
    prisma.workspace.findFirst.mockResolvedValue(null)

    await expect(service.remove('u1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.workspace.count).not.toHaveBeenCalled()
    expect(prisma.workspace.delete).not.toHaveBeenCalled()
  })
})
