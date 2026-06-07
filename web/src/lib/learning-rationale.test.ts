import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  LEARNING_RATIONALE,
  type LearningRationaleKey,
} from '@/lib/learning-rationale'

// DET-306. The friction points carry a learning-science "why-line". Two cheap
// guarantees, mirroring the labels guard (DET-304):
//   1. Tone holds — calm, editorial, no exclamation marks (the acceptance bar).
//   2. Single source of truth — every wired surface references the copy module
//      rather than inlining its own string, so the lines can't drift apart.

// vitest runs with the web workspace as cwd (vitest.config.ts root).
const srcDir = join(process.cwd(), 'src')

const KEYS: LearningRationaleKey[] = [
  'articulate',
  'articulateVerbatim',
  'connect',
  'retrieve',
  'validate',
  'predict',
  'rewritePeek',
]

describe('learning rationale copy', () => {
  it('covers every friction point with a non-empty line', () => {
    expect(Object.keys(LEARNING_RATIONALE).sort()).toEqual([...KEYS].sort())
    for (const key of KEYS) {
      expect(LEARNING_RATIONALE[key].trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps the calm editorial tone — no exclamation marks', () => {
    for (const key of KEYS) {
      expect(LEARNING_RATIONALE[key]).not.toContain('!')
    }
  })
})

describe('single source of truth', () => {
  // Each surface must render the why-line FROM the module, never inline a copy.
  const FILES = [
    'app/(app)/inbox/[id]/promote/page.tsx',
    'components/deep-reading/predict-mode.tsx',
    'components/deep-reading/rewrite-mode.tsx',
  ]

  for (const rel of FILES) {
    it(`${rel} sources its why-lines from the copy module`, () => {
      const source = readFileSync(`${srcDir}/${rel}`, 'utf8')
      expect(source).toContain('LEARNING_RATIONALE')
      // The literal copy lives only in learning-rationale.ts. If a surface inlines
      // one of the strings instead of referencing the module, this catches it.
      for (const key of KEYS) {
        expect(source).not.toContain(LEARNING_RATIONALE[key])
      }
    })
  }
})
