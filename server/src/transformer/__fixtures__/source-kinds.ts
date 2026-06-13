import type { ClassifiedBlockInput } from '../structure-model.service'

/**
 * Source-kind detection fixtures (DET-345). Hand-authored block sets that
 * exercise each `SourceKind`'s signature — the detector's unit tests run the pure
 * `diagnoseSource` over these and assert the kind + selected shape. They are
 * deliberately distinct from the golden `__fixtures__` (which pair blocks with a
 * full v2 article); here only the SOURCE blocks matter.
 *
 * Block `type` is the Prisma `TransformerBlockType` name (HEADING/PARAGRAPH/…);
 * `classification` is free-form (the detector never relies on a specific
 * classification vocabulary — see source-diagnosis.util.ts).
 */

/** A spoken lesson transcript: headingless, filler, first/second person. */
export const transcriptLessonBlocks: ClassifiedBlockInput[] = [
  {
    id: 't1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Okay so, um, today I wanna talk about how gradient descent actually works, you know, under the hood.',
    removable: false,
  },
  {
    id: 't2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "So basically, you've got this loss surface, right? And we're trying to, like, walk downhill to the lowest point.",
    removable: false,
  },
  {
    id: 't3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "I mean, the learning rate is kind of how big each step is. If it's too big you overshoot, if it's too small it takes forever.",
    removable: false,
  },
  {
    id: 't4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "Alright, so let's, uh, look at what happens when we tune that knob over a few epochs and see how the curve settles.",
    removable: false,
  },
]

/** A structured encyclopedic web article: heading + substantial prose. */
export const structuredWebArticleBlocks: ClassifiedBlockInput[] = [
  {
    id: 'w1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Photosynthesis',
    removable: false,
  },
  {
    id: 'w2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Photosynthesis is the biological process by which green plants, algae and some bacteria convert light energy into chemical energy stored in the bonds of sugar molecules.',
    removable: false,
  },
  {
    id: 'w3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Light-dependent reactions',
    removable: false,
  },
  {
    id: 'w4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'In the thylakoid membranes, chlorophyll absorbs photons and excites electrons, driving the synthesis of ATP and NADPH that the cell later uses to fix carbon.',
    removable: false,
  },
  {
    id: 'w5',
    type: 'PARAGRAPH',
    classification: 'SUPPORTING',
    text: 'Oxygen is liberated as a by-product when water molecules are split to replace the donated electrons during these reactions.',
    removable: false,
  },
]

/** A research paper: canonical headings + inline citations + a references list. */
export const researchPaperBlocks: ClassifiedBlockInput[] = [
  {
    id: 'r1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Abstract',
    removable: false,
  },
  {
    id: 'r2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We present a method for stabilising expert routing in sparse mixture-of-experts models as they scale beyond one trillion parameters.',
    removable: false,
  },
  {
    id: 'r3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Introduction',
    removable: false,
  },
  {
    id: 'r4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Prior work has shown that routing collapses at scale [1], and that load-balancing losses only partially mitigate it (Smith et al., 2021).',
    removable: false,
  },
  {
    id: 'r5',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Methods',
    removable: false,
  },
  {
    id: 'r6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We anneal the auxiliary load-balancing coefficient over training and measure routing entropy across 12 checkpoints, following the protocol of Jones et al. (2020) [2].',
    removable: false,
  },
  {
    id: 'r7',
    type: 'HEADING',
    classification: 'CORE',
    text: 'References',
    removable: false,
  },
  {
    id: 'r8',
    type: 'PARAGRAPH',
    classification: 'CITATION',
    text: '[1] Shazeer et al. (2017). Outrageously large neural networks. doi:10.48550/arXiv.1701.06538',
    removable: false,
  },
]

/** Technical documentation: doc headings, code, imperative prose. */
export const documentationBlocks: ClassifiedBlockInput[] = [
  {
    id: 'd1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Installation',
    removable: false,
  },
  {
    id: 'd2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Install the package from npm before importing it into your project.',
    removable: false,
  },
  {
    id: 'd3',
    type: 'CODE',
    classification: 'CORE',
    text: 'npm install @acme/widget',
    removable: false,
  },
  {
    id: 'd4',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Usage',
    removable: false,
  },
  {
    id: 'd5',
    type: 'CODE',
    classification: 'CORE',
    text: "import { Widget } from '@acme/widget'\nconst w = new Widget({ size: 4 })\nw.render()",
    removable: false,
  },
  {
    id: 'd6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Call render() after configuring the widget options described below.',
    removable: false,
  },
]

/** A reference-style doc: an options table + parameter list, little code. */
export const referenceDocBlocks: ClassifiedBlockInput[] = [
  {
    id: 'rd1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'API reference',
    removable: false,
  },
  {
    id: 'rd2',
    type: 'TABLE',
    classification: 'CORE',
    text: 'Option | Type | Default\nsize | number | 1\ncolor | string | "black"',
    removable: false,
  },
  {
    id: 'rd3',
    type: 'LIST',
    classification: 'CORE',
    text: 'size: the widget size\ncolor: the fill color\nonClick: click handler',
    removable: false,
  },
  {
    id: 'rd4',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Parameters',
    removable: false,
  },
  {
    id: 'rd5',
    type: 'TABLE',
    classification: 'CORE',
    text: 'Method | Returns\nrender() | void\ndestroy() | void',
    removable: false,
  },
]

/** Raw notes: terse fragments and bullets, no real heading structure. */
export const rawNotesBlocks: ClassifiedBlockInput[] = [
  {
    id: 'n1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'mtg notes - routing project',
    removable: false,
  },
  {
    id: 'n2',
    type: 'LIST',
    classification: 'CORE',
    text: 'ship v2 first\ncheck latency\nask Dana re: budget',
    removable: false,
  },
  {
    id: 'n3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'todo: refactor cache',
    removable: false,
  },
  {
    id: 'n4',
    type: 'LIST',
    classification: 'CORE',
    text: 'q3 goals\nhiring\noffsite?',
    removable: false,
  },
  {
    id: 'n5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'follow up next week',
    removable: false,
  },
]

/** Ambiguous / sparse input that should fall back to `unknown`. */
export const ambiguousBlocks: ClassifiedBlockInput[] = [
  {
    id: 'x1',
    type: 'UNKNOWN',
    classification: 'UNCERTAIN',
    text: 'Lorem ipsum dolor sit amet.',
    removable: false,
  },
]
