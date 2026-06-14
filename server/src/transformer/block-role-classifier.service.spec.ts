import { SourceBlockPlacement, SourceBlockRole } from '@kibadist/prisma'

import type { AiService } from '../ai/ai.service'
import {
  roleFixtures,
  systemsArticleFixture,
  udemyTranscriptFixture,
} from './__fixtures__/block-role.fixtures'
import {
  BlockRoleClassifierService,
  type RoleClassifierInputBlock,
} from './block-role-classifier.service'

function makeService(completeImpl?: jest.Mock) {
  const complete = completeImpl ?? jest.fn()
  const ai = { complete } as unknown as AiService
  return { service: new BlockRoleClassifierService(ai), complete }
}

/** A mock that returns a fixed model response as the LLM's raw JSON text. */
function respondWith(response: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    text: JSON.stringify(response),
    model: 'fixture',
  })
}

describe('BlockRoleClassifierService', () => {
  it('pre-pass settles TABLE and CAPTION block types without the LLM', async () => {
    const { service, complete } = makeService()
    const out = await service.classify([
      { index: 0, blockType: 'TABLE', text: 'a | b\n1 | 2' },
      { index: 1, blockType: 'CAPTION', text: 'Figure 1: a chart.' },
    ])
    expect(complete).not.toHaveBeenCalled()
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.TABLE,
      placement: SourceBlockPlacement.MAIN_BODY,
    })
    expect(out.get(1)).toMatchObject({
      role: SourceBlockRole.CAPTION,
      placement: SourceBlockPlacement.MAIN_BODY,
    })
  })

  it('pre-pass settles obvious navigation/footer chrome as DISCARD', async () => {
    const { service, complete } = makeService()
    const out = await service.classify([
      { index: 0, blockType: 'PARAGRAPH', text: '© 2024 Acme Corp' },
    ])
    expect(complete).not.toHaveBeenCalled()
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.NAVIGATION,
      placement: SourceBlockPlacement.DISCARD,
    })
  })

  it('pre-pass settles transcript filler as DISCARD', async () => {
    const { service, complete } = makeService()
    const out = await service.classify([
      { index: 0, blockType: 'PARAGRAPH', text: 'Um, okay, so, hi everyone!' },
    ])
    expect(complete).not.toHaveBeenCalled()
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.FILLER,
      placement: SourceBlockPlacement.DISCARD,
    })
  })

  it('sends un-resolved blocks to ONE batched LLM call and applies guards', async () => {
    const complete = respondWith({
      classifications: [
        { index: 0, role: 'core_claim', importance: 'high' },
        { index: 1, role: 'bibliography', placement: 'discard' },
      ],
    })
    const { service } = makeService(complete)
    const out = await service.classify([
      {
        index: 0,
        blockType: 'PARAGRAPH',
        text: 'A central claim of the piece.',
      },
      {
        index: 1,
        blockType: 'PARAGRAPH',
        text: '[2] Smith, J. A Paper. Journal, 2020.',
      },
    ])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.CORE_CLAIM,
      placement: SourceBlockPlacement.MAIN_BODY,
    })
    // Guard moved the (wrongly-discarded) bibliography entry to source notes.
    expect(out.get(1)).toMatchObject({
      role: SourceBlockRole.BIBLIOGRAPHY,
      placement: SourceBlockPlacement.SOURCE_NOTES,
    })
  })

  it('defaults every LLM-batch block to the UNKNOWN role when the call fails', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('provider down'))
    const { service } = makeService(complete)
    const out = await service.classify([
      { index: 0, blockType: 'PARAGRAPH', text: 'Real content paragraph one.' },
      { index: 1, blockType: 'PARAGRAPH', text: 'Real content paragraph two.' },
    ])
    expect(out.get(0)?.role).toBe(SourceBlockRole.UNKNOWN)
    expect(out.get(1)?.role).toBe(SourceBlockRole.UNKNOWN)
    // UNKNOWN is preserve-by-default: never discarded.
    expect(out.get(0)?.placement).toBe(SourceBlockPlacement.MAIN_BODY)
  })

  // --- Fixture suite (DET-346 acceptance) ----------------------------------
  describe.each(roleFixtures)('fixture: $name', (fixture) => {
    it('classifies every block with a role and an importance', async () => {
      const { service } = makeService(respondWith(fixture.modelResponse))
      const out = await service.classify(fixture.blocks)
      expect(out.size).toBe(fixture.blocks.length)
      for (const block of fixture.blocks) {
        const resolved = out.get(block.index)
        expect(resolved).toBeDefined()
        expect(resolved?.role).toBeTruthy()
        expect(resolved?.importance).toBeTruthy()
        expect(resolved?.placement).toBeTruthy()
      }
    })

    it('resolves the expected role + placement per block', async () => {
      const { service } = makeService(respondWith(fixture.modelResponse))
      const out = await service.classify(fixture.blocks)
      for (const [index, exp] of Object.entries(fixture.expected)) {
        const resolved = out.get(Number(index))
        expect(resolved?.role).toBe(exp.role)
        expect(resolved?.placement).toBe(exp.placement)
        if (exp.importance) {
          expect(resolved?.importance).toBe(exp.importance)
        }
      }
    })
  })

  it('udemy transcript: filler is discarded, substance is kept in body/callouts', async () => {
    const f = udemyTranscriptFixture
    const { service } = makeService(respondWith(f.modelResponse))
    const out = await service.classify(f.blocks)
    const discarded = [...out.values()].filter(
      (r) => r.placement === SourceBlockPlacement.DISCARD,
    )
    // Every discarded block is filler/navigation — never substance.
    expect(discarded.every((r) => r.role === SourceBlockRole.FILLER)).toBe(true)
    // The analogy and the instructor aside are preserved as callouts.
    expect(out.get(4)?.placement).toBe(SourceBlockPlacement.CALLOUT)
    expect(out.get(7)?.placement).toBe(SourceBlockPlacement.CALLOUT)
  })

  it('systems article: references move to source notes, table/caption are retained', async () => {
    const f = systemsArticleFixture
    const { service } = makeService(respondWith(f.modelResponse))
    const out = await service.classify(f.blocks)
    expect(out.get(3)?.placement).toBe(SourceBlockPlacement.MAIN_BODY) // table
    expect(out.get(4)?.placement).toBe(SourceBlockPlacement.MAIN_BODY) // caption
    expect(out.get(7)?.placement).toBe(SourceBlockPlacement.SOURCE_NOTES) // bibliography
    expect(out.get(8)?.placement).toBe(SourceBlockPlacement.SOURCE_NOTES) // external link
    expect(out.get(9)?.placement).toBe(SourceBlockPlacement.DISCARD) // © footer
  })

  it('classifies an empty input set without calling the LLM', async () => {
    const { service, complete } = makeService()
    const out = await service.classify([] as RoleClassifierInputBlock[])
    expect(out.size).toBe(0)
    expect(complete).not.toHaveBeenCalled()
  })
})
