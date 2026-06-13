import { SourceBlockRole } from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import {
  applyRoleGuards,
  buildRoleClassificationPrompt,
  defaultResolution,
  type ResolvedRole,
  type RoleClassifiableBlock,
  RoleClassificationResponseSchema,
} from './block-role-classifier.prompt'
import { completeJson } from './llm-json.util'

/**
 * Block role classifier (DET-346). Runs after segmentation and before article
 * generation, assigning every source block an editorial role + importance +
 * recommended placement + reason + confidence so downstream generation keeps the
 * learning substance and moves/discards filler, navigation, and reference clutter.
 *
 * A deterministic heuristic pre-pass settles the unambiguous blocks WITHOUT the
 * LLM (TABLE/CAPTION block types map straight to their role; obvious site chrome
 * matches a marker). The rest go in ONE batched `completeJson` call. Code guards
 * (in the prompt module) enforce the placement invariants AFTER the model
 * responds — never trusting the prompt.
 *
 * The LLM batch is wrapped defensively: if the call fails (provider down, schema
 * invalid after retry), every un-pre-classified block falls back to the UNKNOWN
 * role (preserve-by-default) — role classification never blocks the pipeline.
 */

/** The minimal block shape the classifier needs (order index + type + text). */
export interface RoleClassifierInputBlock {
  index: number
  blockType: string
  text: string
}

/** Markers that strongly indicate site chrome → NAVIGATION (discardable). */
const NAVIGATION_MARKERS = [
  /all rights reserved|©|\(c\)\s*\d{4}|copyright\s+\d{4}/i,
  /privacy policy|terms of service|cookie policy|terms (?:&|and) conditions/i,
  /skip to (?:main )?content|breadcrumb|main menu|share this|related (?:posts|articles)|read more|subscribe to our newsletter|sign up for/i,
  /advertisement|sponsored content|promoted|\bad\s*[:•]|buy now|shop now/i,
]

/**
 * Markers for transcript FILLER — pure greetings / sign-offs / encouragement /
 * false starts with no substance. Only applied to SHORT blocks so a real
 * paragraph that merely opens with "so," isn't culled.
 */
const FILLER_MARKERS = [
  /^(?:um+|uh+|er+|hmm+|okay|ok|so|yeah|alright|right)[\s,.]/i,
  /^(?:hi|hey|hello)\b.*\b(?:everyone|everybody|guys|folks|all)\b/i,
  /\bcan you (?:hear|see) me\b/i,
  /^(?:welcome back|thanks for watching|see you (?:in the )?next|don't forget to (?:like|subscribe)|let's get started|let's dive in)\b/i,
]

@Injectable()
export class BlockRoleClassifierService {
  private readonly logger = new Logger(BlockRoleClassifierService.name)

  constructor(private readonly ai: AiService) {}

  /**
   * Classify every input block's editorial role. Returns a map keyed by block
   * index. Heuristic pre-pass first; the rest in one batched LLM call (guards
   * applied); on LLM failure the remaining blocks default to the UNKNOWN role.
   */
  async classify(
    blocks: RoleClassifierInputBlock[],
  ): Promise<Map<number, ResolvedRole>> {
    const resolved = new Map<number, ResolvedRole>()
    const forLlm: RoleClassifiableBlock[] = []

    for (const block of blocks) {
      const heuristic = this.preClassify(block)
      if (heuristic) {
        resolved.set(block.index, heuristic)
        continue
      }
      forLlm.push({
        index: block.index,
        blockType: block.blockType,
        text: block.text,
      })
    }

    if (forLlm.length === 0) return resolved

    const indices = forLlm.map((b) => b.index)
    try {
      const { system, prompt } = buildRoleClassificationPrompt(forLlm)
      const response = await completeJson(this.ai, {
        system,
        prompt,
        schema: RoleClassificationResponseSchema,
        maxTokens: 3000,
      })
      const guarded = applyRoleGuards(response, indices)
      for (const [index, value] of guarded) resolved.set(index, value)
    } catch (error) {
      // Defensive: role classification must never block the pipeline. Any block
      // the LLM couldn't resolve is preserved as the UNKNOWN role.
      this.logger.warn(
        `Block role classification LLM call failed; defaulting ${indices.length} blocks to UNKNOWN: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      for (const index of indices) {
        if (!resolved.has(index)) {
          resolved.set(
            index,
            defaultResolution(index, SourceBlockRole.UNKNOWN, null, 0),
          )
        }
      }
    }

    return resolved
  }

  /**
   * Deterministic pre-pass: settle the unambiguous blocks without the LLM.
   * Returns null when the block needs the model. TABLE/CAPTION block types map
   * straight to their role (the segmenter already typed them); obvious chrome
   * matches a NAVIGATION marker; short pure-filler matches a FILLER marker.
   */
  private preClassify(block: RoleClassifierInputBlock): ResolvedRole | null {
    const type = block.blockType.toUpperCase()

    // The segmenter already typed these structurally — trust it, no LLM needed.
    if (type === 'TABLE') {
      return defaultResolution(
        block.index,
        SourceBlockRole.TABLE,
        'tabular data (structural block type)',
        1,
      )
    }
    if (type === 'CAPTION') {
      return defaultResolution(
        block.index,
        SourceBlockRole.CAPTION,
        'figure/table caption (structural block type)',
        1,
      )
    }

    // Obvious chrome / filler markers only apply to SHORT blocks; a long
    // paragraph that merely mentions "subscribe" is left to the LLM.
    if (block.text.length <= 200) {
      for (const re of NAVIGATION_MARKERS) {
        if (re.test(block.text)) {
          return defaultResolution(
            block.index,
            SourceBlockRole.NAVIGATION,
            'navigation/footer/ad chrome',
            0.9,
          )
        }
      }
    }
    if (block.text.length <= 120) {
      for (const re of FILLER_MARKERS) {
        if (re.test(block.text.trim())) {
          return defaultResolution(
            block.index,
            SourceBlockRole.FILLER,
            'transcript filler (greeting/false start/sign-off)',
            0.85,
          )
        }
      }
    }

    return null
  }
}
