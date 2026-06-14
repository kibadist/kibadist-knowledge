import { Injectable } from '@nestjs/common'

import { AiService } from '../../ai/ai.service'
import { completeJson } from '../llm-json.util'
import {
  type AssemblyBlockV3,
  assembleArticleV3,
  type V3AssemblyMeta,
} from './v3-assembly.util'
import type { ArticleJsonV3 } from './v3-contract'
import {
  buildLearningPrompt,
  buildRewritePrompt,
  type V3PromptBlock,
  type V3RegenNote,
} from './v3-generator.prompt'
import { V3LearningLlmSchema, V3RewriteLlmSchema } from './v3-llm.schema'

/** A loaded source block as the v3 generator consumes it. */
export interface V3GeneratorBlock {
  id: string
  blockType: string
  classification: string | null
  removable: boolean
  text: string
}

/**
 * The v3 source-grounded generator (DET-343). Two LLM calls via `completeJson`
 * (rewrite, then learning extraction), then DETERMINISTIC assembly in
 * `assembleArticleV3` — the single place grounding/provenance/claim-support and the
 * quality gate are decided in code. Mirrors the v2 services' posture: the model is
 * untrusted, the schema is necessary-not-sufficient, and the assembler re-checks
 * every cited id against the real blocks.
 *
 * `generate` runs the fresh pass; `regenerate` runs a TARGETED pass given the
 * quality gate's regeneration instructions (the same two calls, with the blockers
 * fed back into both prompts).
 */
@Injectable()
export class V3GeneratorService {
  constructor(private readonly ai: AiService) {}

  generate(
    blocks: V3GeneratorBlock[],
    meta: V3AssemblyMeta,
  ): Promise<ArticleJsonV3> {
    return this.run(blocks, meta, [])
  }

  regenerate(
    blocks: V3GeneratorBlock[],
    meta: V3AssemblyMeta,
    regenNotes: V3RegenNote[],
  ): Promise<ArticleJsonV3> {
    return this.run(blocks, meta, regenNotes)
  }

  private async run(
    blocks: V3GeneratorBlock[],
    meta: V3AssemblyMeta,
    regenNotes: V3RegenNote[],
  ): Promise<ArticleJsonV3> {
    // The generator only sees substance blocks; removable noise (nav/footer/ads)
    // is handled deterministically as source notes in assembly.
    const substance = blocks.filter((b) => !b.removable)
    const promptBlocks: V3PromptBlock[] = substance.map((b) => ({
      id: b.id,
      blockType: b.blockType,
      classification: b.classification,
      text: b.text,
    }))

    const rewritePrompt = buildRewritePrompt(
      promptBlocks,
      meta.sourceKind,
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
      meta.sourceKind,
      regenNotes,
    )
    const learning = await completeJson(this.ai, {
      system: learningPrompt.system,
      prompt: learningPrompt.prompt,
      schema: V3LearningLlmSchema,
      maxTokens: 8000,
    })

    const assemblyBlocks: AssemblyBlockV3[] = blocks.map((b) => ({
      id: b.id,
      blockType: b.blockType,
      classification: b.classification,
      removable: b.removable,
      text: b.text,
    }))
    return assembleArticleV3(rewrite, learning, assemblyBlocks, meta)
  }
}
