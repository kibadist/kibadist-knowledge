import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { completeJson } from './llm-json.util'
import {
  type SourceStructureModel,
  SourceStructureModelSchema,
} from './schemas'
import {
  buildStructureModelPrompt,
  type PromptBlock,
} from './structure-model.prompt'

/** A classified block as the structure modeler consumes it. */
export interface ClassifiedBlockInput {
  id: string
  type: string
  classification: string
  text: string
  removable: boolean
}

/**
 * Structure-model service (DET-251, pipeline step 6). One LLM call via
 * `completeJson(SourceStructureModelSchema)`, then a CODE post-validation that
 * every cited block id actually exists. Missing traceability or an unknown id —
 * after completeJson's single retry — throws, which the pipeline turns into the
 * article's FAILED status ("fail loudly"). The LLM is never trusted to have
 * obeyed the traceability rule.
 */
@Injectable()
export class StructureModelService {
  constructor(private readonly ai: AiService) {}

  async build(blocks: ClassifiedBlockInput[]): Promise<SourceStructureModel> {
    const keep = blocks.filter((b) => !b.removable)
    const removable = blocks.filter((b) => b.removable)
    const known = new Set(blocks.map((b) => b.id))

    const { system, prompt } = buildStructureModelPrompt(
      keep.map(toPromptBlock),
      removable.map(toPromptBlock),
    )
    const model = await completeJson(this.ai, {
      system,
      prompt,
      schema: SourceStructureModelSchema,
      maxTokens: 4000,
    })

    assertKnownIds(model, known)
    return model
  }
}

function toPromptBlock(b: ClassifiedBlockInput): PromptBlock {
  return {
    id: b.id,
    type: b.type,
    classification: b.classification,
    text: b.text,
  }
}

/**
 * Code-enforced traceability (DET-251). Every block id cited anywhere in the
 * model must exist in the source. The schema already guarantees the arrays are
 * non-empty; here we guarantee they reference REAL blocks. Any violation throws
 * → the pipeline marks the article FAILED.
 */
function assertKnownIds(
  model: SourceStructureModel,
  known: ReadonlySet<string>,
): void {
  const unknown = new Set<string>()
  const check = (ids: string[]) => {
    for (const id of ids) if (!known.has(id)) unknown.add(id)
  }

  if (model.title) check(model.title.sourceBlockIds)
  if (model.subtitle) check(model.subtitle.sourceBlockIds)
  for (const c of model.claims) check(c.sourceBlockIds)
  for (const d of model.definitions) check(d.sourceBlockIds)
  for (const e of model.examples) check(e.sourceBlockIds)
  for (const c of model.caveats) check(c.sourceBlockIds)
  for (const t of model.terminology) check(t.sourceBlockIds)
  for (const o of model.originalOutline) check(o.sourceBlockIds)
  for (const n of model.noiseDecisions)
    if (!known.has(n.blockId)) unknown.add(n.blockId)
  for (const id of model.uncertainBlockIds) if (!known.has(id)) unknown.add(id)

  if (unknown.size > 0) {
    throw new Error(
      `Structure model references unknown block ids: ${[...unknown].join(', ')}`,
    )
  }
}
