import { TransformerBlockClass } from '@kibadist/prisma'

import type { AiService } from '../ai/ai.service'
import {
  BlockClassifierService,
  type ClassifierInputBlock,
} from './block-classifier.service'

function makeService(completeImpl?: jest.Mock) {
  const complete = completeImpl ?? jest.fn()
  const ai = { complete } as unknown as AiService
  return { service: new BlockClassifierService(ai), complete }
}

describe('BlockClassifierService', () => {
  it('heuristic pre-pass classifies a footer without calling the LLM', async () => {
    const { service, complete } = makeService()
    const blocks: ClassifierInputBlock[] = [
      { index: 0, blockType: 'PARAGRAPH', text: '© 2024 Acme Corp' },
    ]
    const out = await service.classify(blocks)
    expect(out.get(0)).toMatchObject({
      classification: TransformerBlockClass.FOOTER,
      removable: true,
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it('heuristic pre-pass culls an exact-duplicate block as removable DUPLICATE', async () => {
    const { service, complete } = makeService()
    const repeated = 'This is a sufficiently long repeated sentence.'
    const out = await service.classify([
      { index: 0, blockType: 'PARAGRAPH', text: repeated },
      { index: 1, blockType: 'PARAGRAPH', text: repeated },
    ])
    // First occurrence goes to the LLM; the LLM mock wasn't configured, so the
    // batch fails and it falls back to UNCERTAIN — but the DUPLICATE is decided
    // deterministically regardless.
    expect(out.get(1)).toMatchObject({
      classification: TransformerBlockClass.DUPLICATE,
      removable: true,
    })
    // Only the first (non-duplicate) block is sent to the LLM batch.
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('sends un-resolved blocks to ONE batched LLM call and applies guards', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        classifications: [
          { index: 0, classification: 'MAIN_ARGUMENT' },
          {
            index: 1,
            classification: 'ADVERTISEMENT',
            removable: true,
            noiseReason: 'promo',
          },
        ],
      }),
      model: 'stub',
    })
    const { service } = makeService(complete)
    const out = await service.classify([
      {
        index: 0,
        blockType: 'PARAGRAPH',
        text: 'A core claim about the topic at hand.',
      },
      {
        index: 1,
        blockType: 'PARAGRAPH',
        text: 'Some marketing-ish prose here.',
      },
    ])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(out.get(0)?.classification).toBe(TransformerBlockClass.MAIN_ARGUMENT)
    expect(out.get(1)).toMatchObject({
      classification: TransformerBlockClass.ADVERTISEMENT,
      removable: true,
      noiseReason: 'promo',
    })
  })

  it('defaults every LLM-batch block to UNCERTAIN when the call fails', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('provider down'))
    const { service } = makeService(complete)
    const out = await service.classify([
      { index: 0, blockType: 'PARAGRAPH', text: 'Real content paragraph one.' },
      { index: 1, blockType: 'PARAGRAPH', text: 'Real content paragraph two.' },
    ])
    expect(out.get(0)?.classification).toBe(TransformerBlockClass.UNCERTAIN)
    expect(out.get(1)?.classification).toBe(TransformerBlockClass.UNCERTAIN)
    expect(out.get(0)?.removable).toBe(false)
  })
})
