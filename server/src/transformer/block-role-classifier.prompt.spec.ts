import {
  SourceBlockImportance,
  SourceBlockPlacement,
  SourceBlockRole,
} from '@kibadist/prisma'

import {
  applyRoleGuards,
  type RoleClassificationResponse,
} from './block-role-classifier.prompt'

/** Build a one-item response with the model's lowercase wire tokens. */
function response(
  item: RoleClassificationResponse['classifications'][number],
): RoleClassificationResponse {
  return { classifications: [item] }
}

describe('applyRoleGuards', () => {
  it('defaults importance + placement when the model omits them', () => {
    const out = applyRoleGuards(response({ index: 0, role: 'analogy' }), [0])
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.ANALOGY,
      importance: SourceBlockImportance.MEDIUM,
      placement: SourceBlockPlacement.CALLOUT,
      confidence: 0.5,
    })
  })

  it('maps lowercase wire tokens to the Prisma enums', () => {
    const out = applyRoleGuards(
      response({
        index: 0,
        role: 'core_claim',
        importance: 'high',
        placement: 'main_body',
        reason: 'the thesis',
        confidence: 0.9,
      }),
      [0],
    )
    expect(out.get(0)).toEqual({
      index: 0,
      role: SourceBlockRole.CORE_CLAIM,
      importance: SourceBlockImportance.HIGH,
      placement: SourceBlockPlacement.MAIN_BODY,
      reason: 'the thesis',
      confidence: 0.9,
    })
  })

  it.each([
    'core_claim',
    'definition',
    'example',
    'analogy',
    'caveat',
    'instructor_aside',
    'caption',
    'table',
    'unknown',
  ])('substance role %s is never DISCARDed even if the model says so', (role) => {
    const out = applyRoleGuards(
      response({ index: 0, role, placement: 'discard' }),
      [0],
    )
    expect(out.get(0)?.placement).not.toBe(SourceBlockPlacement.DISCARD)
  })

  it.each([
    'reference',
    'bibliography',
    'external_link',
  ])('reference role %s is MOVED to source notes, never discarded', (role) => {
    const out = applyRoleGuards(
      response({ index: 0, role, placement: 'discard' }),
      [0],
    )
    expect(out.get(0)?.placement).toBe(SourceBlockPlacement.SOURCE_NOTES)
  })

  it.each([
    'filler',
    'navigation',
  ])('allows the model to DISCARD non-substance role %s', (role) => {
    const out = applyRoleGuards(
      response({ index: 0, role, placement: 'discard' }),
      [0],
    )
    expect(out.get(0)?.placement).toBe(SourceBlockPlacement.DISCARD)
  })

  it('clamps confidence into [0, 1]', () => {
    const out = applyRoleGuards(
      {
        classifications: [
          { index: 0, role: 'core_claim', confidence: 5 },
          { index: 1, role: 'core_claim', confidence: -3 },
        ],
      },
      [0, 1],
    )
    expect(out.get(0)?.confidence).toBe(1)
    expect(out.get(1)?.confidence).toBe(0)
  })

  it('defaults a missing index to the UNKNOWN role (preserve-by-default)', () => {
    const out = applyRoleGuards({ classifications: [] }, [0, 1])
    expect(out.get(0)).toMatchObject({
      role: SourceBlockRole.UNKNOWN,
      placement: SourceBlockPlacement.MAIN_BODY,
    })
    expect(out.get(1)?.role).toBe(SourceBlockRole.UNKNOWN)
  })

  it('ignores classifications for indices that were never sent', () => {
    const out = applyRoleGuards(
      response({ index: 99, role: 'core_claim' }),
      [0],
    )
    expect(out.has(99)).toBe(false)
    expect(out.get(0)?.role).toBe(SourceBlockRole.UNKNOWN)
  })

  it('takes the first entry when the model duplicates an index', () => {
    const out = applyRoleGuards(
      {
        classifications: [
          { index: 0, role: 'core_claim' },
          { index: 0, role: 'filler', placement: 'discard' },
        ],
      },
      [0],
    )
    expect(out.get(0)?.role).toBe(SourceBlockRole.CORE_CLAIM)
  })
})
