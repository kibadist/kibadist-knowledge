import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 6 — code-tutorial. A short coding walkthrough. Exercises: CODE blocks
 * (with language, verbatim — code must never be reworded), interleaved prose.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Debouncing a callback in TypeScript',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A debounce delays a function until calls stop arriving for a set interval.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'CODE',
    classification: 'CORE',
    text: 'function debounce(fn, ms) {\n  let t\n  return (...args) => {\n    clearTimeout(t)\n    t = setTimeout(() => fn(...args), ms)\n  }\n}',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Call the returned function as often as you like; only the last call within the window runs.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Debouncing a callback in TypeScript', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'A debounce delays a function until calls stop arriving for a set interval.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Debouncing a callback in TypeScript',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A debounce delays a function until calls stop arriving for a set interval.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'c1',
          type: 'code',
          language: 'typescript',
          text: 'function debounce(fn, ms) {\n  let t\n  return (...args) => {\n    clearTimeout(t)\n    t = setTimeout(() => fn(...args), ms)\n  }\n}',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Call the returned function as often as you like; only the last call within the window runs.',
          sourceBlockIds: ['b4'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'Debounce', sourceBlockIds: ['b2'] }],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    {
      blockId: 'b3',
      blockType: 'CODE',
      preview: 'function debounce(fn, ms) {',
    },
  ],
}

export const codeTutorial: V2Fixture = {
  name: 'code-tutorial',
  blocks,
  article,
}
