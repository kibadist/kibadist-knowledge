import type { AiService } from '../ai/ai.service'
import { RewriteService } from './rewrite.service'
import type { LearningOutline, SourceSegment } from './rewrite.types'

/**
 * Regression snapshot spec (DET-349) for the TWO known failing examples that
 * motivated the v3 engine (EPIC DET-343):
 *
 *  1. A Udemy-style transformer-architecture TRANSCRIPT — the v2 pipeline turned it
 *     into a list of raw transcript fragments. The rewrite must read as an article:
 *     filler is dropped (never cited), spoken lines become clean prose with
 *     `speech_cleanup`/`source_grounded_rewrite` traces.
 *  2. A structured ENCYCLOPEDIA/web article (systems theory) — the v2 pipeline kept
 *     Wikipedia furniture ("References", "External links") as body sections. The
 *     learning outline already reorganized it into a learning flow; the rewrite must
 *     preserve that flow, ground a source analogy as a callout, and DROP an
 *     AI-invented analogy.
 *
 * The model reply is stubbed (no network); the snapshot captures the deterministic
 * post-processed `ArticleSectionV3[]` so a regression in the guards is caught.
 */

function reply(body: unknown) {
  return { text: JSON.stringify(body), model: 'stub' }
}

function aiReturning(replies: unknown[]): AiService {
  const complete = jest.fn()
  for (const r of replies) complete.mockResolvedValueOnce(reply(r))
  return { complete } as unknown as AiService
}

// --- Example 1: transformer-architecture transcript ------------------------

const transcriptSegments: SourceSegment[] = [
  {
    id: 'seg-intro',
    summary: 'what a transformer does at a high level',
    blocks: [
      {
        id: 't1',
        role: 'instructor_aside',
        text: "Um, okay, so, yeah, today we're gonna, like, talk about transformers, right?",
      },
      {
        id: 't2',
        role: 'core_claim',
        text: 'A transformer processes all the tokens in a sequence at the same time, in parallel.',
      },
      {
        id: 't3',
        role: 'definition',
        text: 'Self-attention lets each token look at every other token to decide what matters.',
      },
    ],
  },
  {
    id: 'seg-qkv',
    summary: 'query, key, value',
    blocks: [
      {
        id: 't4',
        role: 'core_claim',
        text: 'Each token is projected into a query, a key, and a value vector.',
      },
      {
        id: 't5',
        role: 'example',
        text: 'The query of one token is compared against the keys of all tokens to score relevance.',
      },
    ],
  },
]

const transcriptOutline: LearningOutline = {
  title: 'How transformers work',
  sourceKind: 'transcript_lesson',
  shape: 'lesson_flow',
  sections: [
    {
      id: 'o1',
      heading: 'Transformers process tokens in parallel',
      headingSource: 'inferred',
      intent: 'Establish the core mental model',
      segmentIds: ['seg-intro'],
    },
    {
      id: 'o2',
      heading: 'Query, key, and value',
      headingSource: 'inferred',
      intent: 'Explain the attention mechanics',
      segmentIds: ['seg-qkv'],
    },
  ],
}

const transcriptReplies = [
  {
    heading: 'Transformers process tokens in parallel',
    headingSource: 'inferred',
    paragraphs: [
      {
        // Filler block t1 is NOT cited — the transcript fragment is dropped, not
        // rendered. This paragraph is grounded in the real claim block.
        text: 'A transformer reads every token in a sequence at once rather than one at a time, processing them in parallel.',
        sourceBlockIds: ['t2'],
        transformationType: 'speech_cleanup',
        fidelityRisk: 'low',
        confidence: 0.92,
      },
      {
        text: 'Self-attention is what makes this possible: each token can look at every other token to decide which ones matter for its meaning.',
        sourceBlockIds: ['t3'],
        transformationType: 'source_grounded_rewrite',
        fidelityRisk: 'low',
        confidence: 0.88,
      },
      {
        // Unsupported — cites a block this section never had → dropped before
        // fidelity review.
        text: 'Transformers were invented in 2017 and power every modern chatbot.',
        sourceBlockIds: ['external-fact'],
        transformationType: 'source_grounded_inference',
        fidelityRisk: 'medium',
        confidence: 0.3,
      },
    ],
  },
  {
    heading: 'Query, key, and value',
    headingSource: 'inferred',
    paragraphs: [
      {
        text: 'Attention works by projecting each token into three vectors: a query, a key, and a value.',
        sourceBlockIds: ['t4'],
        transformationType: 'source_grounded_rewrite',
        fidelityRisk: 'low',
        confidence: 0.9,
      },
      {
        text: "A token's query is compared against every token's key to score how relevant each one is.",
        sourceBlockIds: ['t5'],
        transformationType: 'source_grounded_rewrite',
        fidelityRisk: 'low',
        confidence: 0.85,
      },
    ],
  },
]

// --- Example 2: structured systems-theory encyclopedia article -------------

const systemsSegments: SourceSegment[] = [
  {
    id: 'seg-def',
    summary: 'definition of a system',
    blocks: [
      {
        id: 's1',
        role: 'definition',
        text: 'A system is a set of interrelated components that work together toward a common purpose.',
      },
      {
        id: 's2',
        role: 'analogy',
        text: 'A system can be pictured as an orchestra: many parts coordinating toward one performance.',
      },
    ],
  },
  {
    id: 'seg-open-closed',
    summary: 'open vs closed systems',
    blocks: [
      {
        id: 's3',
        role: 'core_claim',
        text: 'An open system exchanges matter and energy with its environment; a closed system does not.',
      },
      {
        id: 's4',
        role: 'example',
        text: 'A living cell is an open system; a sealed calorimeter approximates a closed one.',
      },
    ],
  },
]

const systemsOutline: LearningOutline = {
  // The outline already dropped the source's "References" / "External links"
  // sections — only learning content remains, reorganized into a flow.
  title: 'Systems theory',
  sourceKind: 'structured_web_article',
  shape: 'concept_explainer',
  sections: [
    {
      id: 'o1',
      heading: 'What is a system?',
      headingSource: 'inferred',
      segmentIds: ['seg-def'],
    },
    {
      id: 'o2',
      heading: 'Open and closed systems',
      headingSource: 'inferred',
      segmentIds: ['seg-open-closed'],
    },
  ],
}

const systemsReplies = [
  {
    heading: 'What is a system?',
    headingSource: 'inferred',
    paragraphs: [
      {
        text: 'A system is a set of interrelated components that work together toward a shared purpose.',
        sourceBlockIds: ['s1'],
        transformationType: 'grammar_cleanup',
        fidelityRisk: 'low',
        confidence: 0.95,
      },
    ],
    callouts: [
      {
        // Grounded in the analogy-role block s2 → kept as a callout.
        calloutType: 'source_analogy',
        title: 'Think of an orchestra',
        text: 'A system is like an orchestra: many parts coordinating toward one performance.',
        sourceBlockIds: ['s2'],
        grounded: true,
      },
      {
        // AI-invented analogy (grounded:false) → dropped in default mode.
        calloutType: 'source_analogy',
        text: 'A system is also like a clock with many gears.',
        sourceBlockIds: ['s1'],
        grounded: false,
      },
    ],
  },
  {
    heading: 'Open and closed systems',
    headingSource: 'inferred',
    paragraphs: [
      {
        text: 'Systems are classified by how they interact with their environment: an open system exchanges matter and energy with it, while a closed system does not.',
        sourceBlockIds: ['s3'],
        transformationType: 'source_grounded_rewrite',
        fidelityRisk: 'low',
        confidence: 0.9,
      },
    ],
    tables: [
      {
        caption: 'Open vs closed systems',
        header: ['Type', 'Example'],
        rows: [
          ['Open', 'A living cell'],
          ['Closed', 'A sealed calorimeter'],
        ],
        sourceBlockIds: ['s4'],
      },
    ],
  },
]

describe('rewrite snapshot — known failing examples', () => {
  it('transcript: reads as an article, drops filler and unsupported claims', async () => {
    const ai = aiReturning(transcriptReplies)
    const sections = await new RewriteService(ai).rewrite(
      transcriptOutline,
      transcriptSegments,
    )

    // The unsupported "invented in 2017" paragraph is gone; filler t1 is uncited.
    const allIds = sections.flatMap((s) =>
      s.paragraphs.flatMap((p) => p.trace.sourceBlockIds),
    )
    expect(allIds).not.toContain('t1')
    expect(allIds).not.toContain('external-fact')
    expect(sections[0].paragraphs).toHaveLength(2)

    expect(sections).toMatchSnapshot()
  })

  it('encyclopedia: learning flow kept, source analogy callout grounded, invented one dropped', async () => {
    const ai = aiReturning(systemsReplies)
    const sections = await new RewriteService(ai).rewrite(
      systemsOutline,
      systemsSegments,
    )

    // The source layout ("References"/"External links") never appears.
    const headings = sections.map((s) => s.heading)
    expect(headings).toEqual(['What is a system?', 'Open and closed systems'])
    // Exactly one analogy callout survives (the grounded one).
    expect(sections[0].callouts).toHaveLength(1)
    expect(sections[0].callouts?.[0].calloutType).toBe('source_analogy')
    expect(sections[1].tables).toHaveLength(1)

    expect(sections).toMatchSnapshot()
  })
})
