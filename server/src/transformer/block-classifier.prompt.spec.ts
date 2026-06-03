import { TransformerBlockClass } from '@kibadist/prisma'

import {
  applyClassificationGuards,
  type ClassificationResponse,
} from './block-classifier.prompt'

describe('applyClassificationGuards', () => {
  it('UNCERTAIN is never removable, even if the model says so', () => {
    const response: ClassificationResponse = {
      classifications: [
        {
          index: 0,
          classification: TransformerBlockClass.UNCERTAIN,
          removable: true,
          noiseReason: 'looks like junk',
        },
      ],
    }
    const out = applyClassificationGuards(response, [0])
    expect(out.get(0)).toMatchObject({
      classification: TransformerBlockClass.UNCERTAIN,
      removable: false,
      noiseReason: null,
    })
  })

  it.each([
    TransformerBlockClass.MAIN_ARGUMENT,
    TransformerBlockClass.DEFINITION,
    TransformerBlockClass.EXAMPLE,
    TransformerBlockClass.EVIDENCE,
  ])('substance class %s is never removable', (cls) => {
    const out = applyClassificationGuards(
      {
        classifications: [
          { index: 0, classification: cls, removable: true, noiseReason: 'x' },
        ],
      },
      [0],
    )
    expect(out.get(0)).toMatchObject({ classification: cls, removable: false })
  })

  it('removable=true without a noiseReason is forced non-removable', () => {
    const out = applyClassificationGuards(
      {
        classifications: [
          {
            index: 0,
            classification: TransformerBlockClass.FOOTER,
            removable: true,
          },
        ],
      },
      [0],
    )
    expect(out.get(0)).toMatchObject({
      classification: TransformerBlockClass.FOOTER,
      removable: false,
      noiseReason: null,
    })
  })

  it('keeps a valid removable noise classification with its reason', () => {
    const out = applyClassificationGuards(
      {
        classifications: [
          {
            index: 0,
            classification: TransformerBlockClass.ADVERTISEMENT,
            removable: true,
            noiseReason: 'sponsored banner',
          },
        ],
      },
      [0],
    )
    expect(out.get(0)).toMatchObject({
      classification: TransformerBlockClass.ADVERTISEMENT,
      removable: true,
      noiseReason: 'sponsored banner',
    })
  })

  it('defaults a missing index to UNCERTAIN, non-removable', () => {
    const out = applyClassificationGuards({ classifications: [] }, [0, 1])
    expect(out.get(0)).toMatchObject({
      classification: TransformerBlockClass.UNCERTAIN,
      removable: false,
    })
    expect(out.get(1)).toMatchObject({
      classification: TransformerBlockClass.UNCERTAIN,
      removable: false,
    })
  })

  it('ignores classifications for indices that were never sent', () => {
    const out = applyClassificationGuards(
      {
        classifications: [
          { index: 99, classification: TransformerBlockClass.MAIN_ARGUMENT },
        ],
      },
      [0],
    )
    expect(out.has(99)).toBe(false)
    expect(out.get(0)?.classification).toBe(TransformerBlockClass.UNCERTAIN)
  })
})
