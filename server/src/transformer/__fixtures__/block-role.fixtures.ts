import {
  SourceBlockImportance,
  SourceBlockPlacement,
  SourceBlockRole,
} from '@kibadist/prisma'

import type { RoleClassifierInputBlock } from '../block-role-classifier.service'

/**
 * Role-classifier fixtures (DET-346). Two hand-authored sources — a spoken Udemy
 * course transcript and a written systems article — recorded WITHOUT a live LLM:
 * each fixture pairs the source blocks with the raw model response the batched
 * call would return for the blocks the deterministic pre-pass leaves to the LLM,
 * plus the expected guard-enforced resolution per block index.
 *
 * `block-role-classifier.service.spec.ts` mocks the AI with `modelResponse` and
 * asserts that `expected` holds after guards — proving filler is discarded,
 * references/links move to source notes, tables/captions are retained, and
 * instructor analogies/asides become callouts, regardless of the raw model output.
 */

export interface ExpectedRole {
  role: SourceBlockRole
  placement: SourceBlockPlacement
  importance?: SourceBlockImportance
}

export interface RoleFixture {
  name: string
  blocks: RoleClassifierInputBlock[]
  /** Raw JSON the LLM returns for the LLM-bound blocks (pre-pass blocks omitted). */
  modelResponse: { classifications: Record<string, unknown>[] }
  /** Expected post-guard resolution, keyed by block index. */
  expected: Record<number, ExpectedRole>
}

/**
 * Udemy transcript: greetings + sign-offs (filler), a core claim, a definition,
 * an instructor analogy + aside, an example, and a caveat. Filler is caught by
 * the deterministic pre-pass; the substance blocks are settled by the LLM.
 */
export const udemyTranscriptFixture: RoleFixture = {
  name: 'udemy-transcript',
  blocks: [
    {
      index: 0,
      blockType: 'PARAGRAPH',
      text: 'Um, okay, so, hi everyone, can you hear me alright?',
    },
    {
      index: 1,
      blockType: 'PARAGRAPH',
      text: "Welcome back to the course. Let's get started.",
    },
    {
      index: 2,
      blockType: 'PARAGRAPH',
      text: 'A hash table stores key-value pairs and gives you average constant-time lookups.',
    },
    {
      index: 3,
      blockType: 'PARAGRAPH',
      text: 'A hash function maps a key to an index in an underlying array.',
    },
    {
      index: 4,
      blockType: 'PARAGRAPH',
      text: 'Think of it like a coat check: you hand over your coat and get a ticket number that tells you exactly which hook to find it on later.',
    },
    {
      index: 5,
      blockType: 'PARAGRAPH',
      text: 'For example, storing user records by their email address lets you fetch any user in roughly one step.',
    },
    {
      index: 6,
      blockType: 'PARAGRAPH',
      text: 'But watch out: if too many keys hash to the same bucket, lookups degrade to linear time.',
    },
    {
      index: 7,
      blockType: 'PARAGRAPH',
      text: 'By the way, I struggled with this concept for weeks when I was learning it, so do not worry if it takes you a while.',
    },
    {
      index: 8,
      blockType: 'PARAGRAPH',
      text: "Okay so, um, yeah, that's basically it for this lesson.",
    },
    {
      index: 9,
      blockType: 'PARAGRAPH',
      text: "Thanks for watching, don't forget to like and subscribe!",
    },
  ],
  modelResponse: {
    classifications: [
      {
        index: 2,
        role: 'core_claim',
        importance: 'high',
        placement: 'main_body',
        reason: 'states the key property of a hash table',
        confidence: 0.95,
      },
      {
        index: 3,
        role: 'definition',
        importance: 'high',
        placement: 'main_body',
        reason: 'defines a hash function',
        confidence: 0.92,
      },
      {
        // Placement omitted on purpose → guard applies the ANALOGY default (callout).
        index: 4,
        role: 'analogy',
        importance: 'medium',
        reason: 'coat-check analogy for hashing',
        confidence: 0.9,
      },
      {
        index: 5,
        role: 'example',
        importance: 'medium',
        placement: 'main_body',
        reason: 'concrete usage example',
        confidence: 0.88,
      },
      {
        // Placement omitted → guard applies the CAVEAT default (callout).
        index: 6,
        role: 'caveat',
        importance: 'medium',
        reason: 'warns about hash collisions',
        confidence: 0.85,
      },
      {
        // Placement omitted → guard applies the INSTRUCTOR_ASIDE default (callout).
        index: 7,
        role: 'instructor_aside',
        importance: 'low',
        reason: 'personal encouragement from the instructor',
        confidence: 0.8,
      },
    ],
  },
  expected: {
    0: {
      role: SourceBlockRole.FILLER,
      placement: SourceBlockPlacement.DISCARD,
    },
    1: {
      role: SourceBlockRole.FILLER,
      placement: SourceBlockPlacement.DISCARD,
    },
    2: {
      role: SourceBlockRole.CORE_CLAIM,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.HIGH,
    },
    3: {
      role: SourceBlockRole.DEFINITION,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.HIGH,
    },
    4: {
      role: SourceBlockRole.ANALOGY,
      placement: SourceBlockPlacement.CALLOUT,
    },
    5: {
      role: SourceBlockRole.EXAMPLE,
      placement: SourceBlockPlacement.MAIN_BODY,
    },
    6: {
      role: SourceBlockRole.CAVEAT,
      placement: SourceBlockPlacement.CALLOUT,
    },
    7: {
      role: SourceBlockRole.INSTRUCTOR_ASIDE,
      placement: SourceBlockPlacement.CALLOUT,
    },
    8: {
      role: SourceBlockRole.FILLER,
      placement: SourceBlockPlacement.DISCARD,
    },
    9: {
      role: SourceBlockRole.FILLER,
      placement: SourceBlockPlacement.DISCARD,
    },
  },
}

/**
 * Systems article: a heading, a core claim, a definition, a comparison TABLE +
 * CAPTION (retained via the deterministic pre-pass on block type), an example, a
 * caveat, a bibliography entry, an external link, and a copyright footer. The
 * bibliography entry's model response says "discard" on purpose — the guard MOVES
 * it to source notes instead of dropping it.
 */
export const systemsArticleFixture: RoleFixture = {
  name: 'systems-article',
  blocks: [
    {
      index: 0,
      blockType: 'HEADING',
      text: 'Consensus in Distributed Systems',
    },
    {
      index: 1,
      blockType: 'PARAGRAPH',
      text: 'Consensus lets a cluster of machines agree on a single value even when some of them fail.',
    },
    {
      index: 2,
      blockType: 'PARAGRAPH',
      text: 'A quorum is the minimum number of nodes that must acknowledge an operation for it to be considered committed.',
    },
    {
      index: 3,
      blockType: 'TABLE',
      text: 'Algorithm | Fault model | Leader\nPaxos | crash | optional\nRaft | crash | required\nPBFT | Byzantine | required',
    },
    {
      index: 4,
      blockType: 'CAPTION',
      text: 'Figure 1: comparison of common consensus algorithms.',
    },
    {
      index: 5,
      blockType: 'PARAGRAPH',
      text: 'For instance, Raft elects a single leader that serializes all writes to the replicated log.',
    },
    {
      index: 6,
      blockType: 'PARAGRAPH',
      text: 'Note that consensus cannot make progress if more than half of the nodes are unreachable.',
    },
    {
      index: 7,
      blockType: 'PARAGRAPH',
      text: '[1] Lamport, L. The Part-Time Parliament. ACM Transactions on Computer Systems, 1998.',
    },
    {
      index: 8,
      blockType: 'PARAGRAPH',
      text: 'See also: https://raft.github.io for an interactive visualization of the algorithm.',
    },
    {
      index: 9,
      blockType: 'PARAGRAPH',
      text: '© 2024 Systems Weekly. All rights reserved.',
    },
  ],
  modelResponse: {
    classifications: [
      {
        index: 0,
        role: 'core_claim',
        importance: 'medium',
        placement: 'main_body',
        reason: 'section heading introducing the topic',
        confidence: 0.6,
      },
      {
        index: 1,
        role: 'core_claim',
        importance: 'high',
        placement: 'main_body',
        reason: 'defines what consensus achieves',
        confidence: 0.95,
      },
      {
        index: 2,
        role: 'definition',
        importance: 'high',
        placement: 'main_body',
        reason: 'defines a quorum',
        confidence: 0.93,
      },
      {
        index: 5,
        role: 'example',
        importance: 'medium',
        placement: 'main_body',
        reason: 'Raft as a concrete instance',
        confidence: 0.9,
      },
      {
        index: 6,
        role: 'caveat',
        importance: 'medium',
        reason: 'liveness limitation under partition',
        confidence: 0.87,
      },
      {
        // Model wrongly says discard — the guard must MOVE this to source notes.
        index: 7,
        role: 'bibliography',
        importance: 'low',
        placement: 'discard',
        reason: 'works-cited entry',
        confidence: 0.8,
      },
      {
        // Placement omitted → guard applies the EXTERNAL_LINK default (source notes).
        index: 8,
        role: 'external_link',
        importance: 'low',
        reason: 'pointer to an external visualization',
        confidence: 0.82,
      },
    ],
  },
  expected: {
    0: {
      role: SourceBlockRole.CORE_CLAIM,
      placement: SourceBlockPlacement.MAIN_BODY,
    },
    1: {
      role: SourceBlockRole.CORE_CLAIM,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.HIGH,
    },
    2: {
      role: SourceBlockRole.DEFINITION,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.HIGH,
    },
    3: {
      role: SourceBlockRole.TABLE,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.HIGH,
    },
    4: {
      role: SourceBlockRole.CAPTION,
      placement: SourceBlockPlacement.MAIN_BODY,
      importance: SourceBlockImportance.MEDIUM,
    },
    5: {
      role: SourceBlockRole.EXAMPLE,
      placement: SourceBlockPlacement.MAIN_BODY,
    },
    6: {
      role: SourceBlockRole.CAVEAT,
      placement: SourceBlockPlacement.CALLOUT,
    },
    7: {
      role: SourceBlockRole.BIBLIOGRAPHY,
      placement: SourceBlockPlacement.SOURCE_NOTES,
    },
    8: {
      role: SourceBlockRole.EXTERNAL_LINK,
      placement: SourceBlockPlacement.SOURCE_NOTES,
    },
    9: {
      role: SourceBlockRole.NAVIGATION,
      placement: SourceBlockPlacement.DISCARD,
    },
  },
}

export const roleFixtures: RoleFixture[] = [
  udemyTranscriptFixture,
  systemsArticleFixture,
]
