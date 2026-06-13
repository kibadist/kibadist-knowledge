import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { collectSectionIds, toArticleV2 } from './article-compat.util'
import { completeJson } from './llm-json.util'
import { ComparisonTablesLlmSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import { buildTablePrompt } from './table-generator.prompt'
import type {
  ArticleComparisonTable,
  ArticleComparisonTableRow,
  ArticleJsonV2,
  ArticleTableCell,
  SourcePreservingArticle,
} from './transformer.types'

/** A comparison needs at least this many grounded rows to be worth a table. */
const MIN_ROWS = 2

/**
 * Table generator (DET-350). LLM via `completeJson(ComparisonTablesLlmSchema)`,
 * then CODE guards reject anything the source can't back:
 *  - per row, keep only `sourceBlockIds` that exist; DROP the row if none survive
 *    (an ungrounded row would require external facts).
 *  - per cell, prune unknown ids (cells lean on row grounding when they have none).
 *  - DROP the table unless it has ≥2 columns and ≥2 grounded rows (otherwise it
 *    is not a comparison).
 *  - the table-level `sourceBlockIds` is recomputed as the union of its rows'
 *    (never trusted from the model); `relatedSectionIds` is clamped to real ids.
 *  - mint a deterministic id (`gtbl-<index>`).
 * The fidelity checker re-verifies the surviving tables' grounding as a second gate.
 */
@Injectable()
export class TableGeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    input: SourcePreservingArticle | ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleComparisonTable[]> {
    const article = toArticleV2(input)
    const known = new Set(blocks.map((b) => b.id))
    const sectionIds = collectSectionIds(article.sections)
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildTablePrompt(
      JSON.stringify(article),
      content,
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: ComparisonTablesLlmSchema,
      maxTokens: 3000,
    })

    const tables: ArticleComparisonTable[] = []
    let index = 0
    for (const t of raw.tables) {
      if (t.columns.length < 2) continue

      const rows: ArticleComparisonTableRow[] = []
      for (const r of t.rows) {
        const rowIds = r.sourceBlockIds.filter((id) => known.has(id))
        // A row with no surviving source grounding would need external facts.
        if (rowIds.length === 0) continue
        const cells: ArticleTableCell[] = r.cells.map((c) => {
          const cellIds = c.sourceBlockIds.filter((id) => known.has(id))
          return cellIds.length > 0
            ? { text: c.text, sourceBlockIds: cellIds }
            : { text: c.text }
        })
        rows.push({ cells, sourceBlockIds: rowIds })
      }
      // A genuine comparison needs at least two grounded rows.
      if (rows.length < MIN_ROWS) continue

      const tableIds = [...new Set(rows.flatMap((r) => r.sourceBlockIds))]
      const related = t.relatedSectionIds.filter((id) => sectionIds.has(id))
      tables.push({
        id: `gtbl-${index++}`,
        title: t.title,
        columns: t.columns,
        rows,
        sourceBlockIds: tableIds,
        relatedSectionIds: related,
        fidelityRisk: t.fidelityRisk,
      })
    }
    return tables
  }
}
