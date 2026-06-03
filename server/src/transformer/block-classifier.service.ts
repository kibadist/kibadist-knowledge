import { TransformerBlockClass } from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import {
  applyClassificationGuards,
  buildClassificationPrompt,
  type ClassifiableBlock,
  ClassificationResponseSchema,
  type ResolvedClassification,
} from './block-classifier.prompt'
import { completeJson } from './llm-json.util'

/**
 * Block classifier (DET-250). A deterministic heuristic pre-pass classifies the
 * obvious noise (nav/footer/ad markers, exact-duplicate text) WITHOUT the LLM;
 * those blocks are excluded from the batch. The remaining blocks go in ONE
 * batched `completeJson` call. Code guards (in the prompt module) enforce the
 * removal invariants AFTER the model responds — never trusting the prompt.
 *
 * The LLM batch is wrapped defensively: if the call fails (provider down, schema
 * invalid after retry), every un-pre-classified block falls back to UNCERTAIN,
 * non-removable — classification never blocks the pipeline reaching READY, and
 * an unsure block is always preserved.
 */

/** The minimal block shape the classifier needs (order index + type + text). */
export interface ClassifierInputBlock {
  index: number
  blockType: string
  text: string
}

/** Markers that strongly indicate site chrome rather than article content. */
const NOISE_MARKERS: {
  re: RegExp
  cls: TransformerBlockClass
  reason: string
}[] = [
  {
    // Non-word symbols (©) can't sit inside \b...\b, so anchors are omitted;
    // the phrases are distinctive enough that substring matching is safe.
    re: /all rights reserved|©|\(c\)\s*\d{4}|copyright\s+\d{4}/i,
    cls: TransformerBlockClass.FOOTER,
    reason: 'copyright/footer boilerplate',
  },
  {
    re: /privacy policy|terms of service|cookie policy|terms (?:&|and) conditions/i,
    cls: TransformerBlockClass.FOOTER,
    reason: 'legal/footer boilerplate',
  },
  {
    re: /skip to (?:main )?content|breadcrumb|main menu|share this|related (?:posts|articles)|read more|subscribe to our newsletter|sign up for/i,
    cls: TransformerBlockClass.NAVIGATION_NOISE,
    reason: 'navigation/share chrome',
  },
  {
    re: /advertisement|sponsored content|promoted|\bad\s*[:•]|buy now|shop now/i,
    cls: TransformerBlockClass.ADVERTISEMENT,
    reason: 'advertising/promotional chrome',
  },
]

@Injectable()
export class BlockClassifierService {
  private readonly logger = new Logger(BlockClassifierService.name)

  constructor(private readonly ai: AiService) {}

  /**
   * Classify every input block. Returns a map keyed by block index. Heuristic
   * pre-pass first; the rest in one batched LLM call (guards applied); on LLM
   * failure the remaining blocks default to UNCERTAIN, non-removable.
   */
  async classify(
    blocks: ClassifierInputBlock[],
  ): Promise<Map<number, ResolvedClassification>> {
    const resolved = new Map<number, ResolvedClassification>()
    const seenText = new Map<string, number>() // normalized text → first index
    const forLlm: ClassifiableBlock[] = []

    for (const block of blocks) {
      const heuristic = this.preClassify(block, seenText)
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
      const { system, prompt } = buildClassificationPrompt(forLlm)
      const response = await completeJson(this.ai, {
        system,
        prompt,
        schema: ClassificationResponseSchema,
        maxTokens: 2000,
      })
      const guarded = applyClassificationGuards(response, indices)
      for (const [index, value] of guarded) resolved.set(index, value)
    } catch (error) {
      // Defensive: classification must never block the pipeline. Any block the
      // LLM couldn't resolve is preserved as UNCERTAIN.
      this.logger.warn(
        `Block classification LLM call failed; defaulting ${indices.length} blocks to UNCERTAIN: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      for (const index of indices) {
        if (!resolved.has(index)) {
          resolved.set(index, {
            index,
            classification: TransformerBlockClass.UNCERTAIN,
            removable: false,
            noiseReason: null,
          })
        }
      }
    }

    return resolved
  }

  /**
   * Deterministic pre-pass: classify obvious noise and exact-duplicate text
   * without the LLM. Returns null when the block needs the model. A DUPLICATE is
   * removable (it's safe to drop a verbatim repeat); marker-matched chrome is
   * removable with its reason. Headings/code/tables are never pre-classified as
   * noise here — they go to the LLM for an editorial role.
   */
  private preClassify(
    block: ClassifierInputBlock,
    seenText: Map<string, number>,
  ): ResolvedClassification | null {
    const normalized = block.text.replace(/\s+/g, ' ').trim().toLowerCase()

    // Exact-duplicate text (a verbatim repeat of an earlier block) → DUPLICATE.
    // Only meaningfully-long text, so a repeated short heading like "Notes"
    // isn't culled; short repeats go to the LLM.
    if (normalized.length >= 24) {
      if (seenText.has(normalized)) {
        return {
          index: block.index,
          classification: TransformerBlockClass.DUPLICATE,
          removable: true,
          noiseReason: 'exact duplicate of an earlier block',
        }
      }
      seenText.set(normalized, block.index)
    }

    // Obvious chrome markers. A SHORT block matching a noise marker is chrome;
    // a long paragraph that merely mentions e.g. "subscribe" is left to the LLM.
    if (block.text.length <= 200) {
      for (const marker of NOISE_MARKERS) {
        if (marker.re.test(block.text)) {
          return {
            index: block.index,
            classification: marker.cls,
            removable: true,
            noiseReason: marker.reason,
          }
        }
      }
    }

    return null
  }
}
