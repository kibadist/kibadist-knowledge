import { Injectable } from '@nestjs/common'

import { AiService } from '../../ai/ai.service'
import { completeJson } from '../llm-json.util'
import type { ArticleJsonV3, SourceKind } from './v3.types'
import { assembleArticleV3 } from './v3-assembly.util'
import {
  buildLearningPrompt,
  buildRewritePrompt,
  type V3PromptBlock,
  type V3RegenNote,
} from './v3-generator.prompt'
import { V3LearningLlmSchema, V3RewriteLlmSchema } from './v3-schemas'

/** A loaded source block as the v3 generator consumes it. */
export interface V3GeneratorBlock {
  id: string
  blockType: string
  classification: string | null
  text: string
}

/**
 * The v3 source-grounded generator (DET-343). Two LLM calls via `completeJson`
 * (rewrite, then learning extraction), then DETERMINISTIC assembly in
 * `assembleArticleV3` which is the single place grounding/provenance/claim-support
 * is decided in code. Mirrors the v2 services' posture: the model is untrusted, the
 * schema is necessary-not-sufficient, and the assembler re-checks every cited id
 * against the real blocks.
 *
 * `generate` runs the fresh pass; `regenerate` runs a TARGETED pass given the
 * quality gate's regeneration targets (the same two calls, with the blockers fed
 * back into both prompts).
 */
@Injectable()
export class V3GeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    blocks: V3GeneratorBlock[],
    sourceKind: SourceKind,
  ): Promise<ArticleJsonV3> {
    return this.run(blocks, sourceKind, [])
  }

  async regenerate(
    blocks: V3GeneratorBlock[],
    sourceKind: SourceKind,
    regenNotes: V3RegenNote[],
  ): Promise<ArticleJsonV3> {
    return this.run(blocks, sourceKind, regenNotes)
  }

  private async run(
    blocks: V3GeneratorBlock[],
    sourceKind: SourceKind,
    regenNotes: V3RegenNote[],
  ): Promise<ArticleJsonV3> {
    const promptBlocks: V3PromptBlock[] = blocks.map((b) => ({
      id: b.id,
      blockType: b.blockType,
      classification: b.classification,
      text: b.text,
    }))
    const known = new Set(blocks.map((b) => b.id))

    const rewritePrompt = buildRewritePrompt(
      promptBlocks,
      sourceKind,
      regenNotes,
    )
    const rewrite = await completeJson(this.ai, {
      system: rewritePrompt.system,
      prompt: rewritePrompt.prompt,
      schema: V3RewriteLlmSchema,
      maxTokens: 16000,
    })

    const learningPrompt = buildLearningPrompt(
      promptBlocks,
      sourceKind,
      regenNotes,
    )
    const learning = await completeJson(this.ai, {
      system: learningPrompt.system,
      prompt: learningPrompt.prompt,
      schema: V3LearningLlmSchema,
      maxTokens: 8000,
    })

    return assembleArticleV3(rewrite, learning, sourceKind, known)
  }
}
