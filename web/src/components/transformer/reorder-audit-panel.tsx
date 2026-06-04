import type {
  ArticleReorderingAudit,
  FidelityRisk,
  TransformerBlockView,
} from '@/lib/api'
import { fidelityRiskChip } from '@/lib/transformer-format'

/**
 * "Behind the article" reorder audit (DET-275). Shows the source-order vs
 * reading-order comparison: each declared reordering as "Block <preview/id> moved
 * from position N → M — reason (risk badge)", with cluster moves surfaced as
 * "moved with cluster (k blocks)". An empty/absent audit states that sections
 * follow source order. Block previews come from the inspector's block data when
 * available, else the raw block id is shown.
 *
 * Extracted as a standalone component (unlike the inline ArticleShapePanel) so it
 * is unit-testable in the web rig without mounting the whole article page.
 */

const RISK_LABEL: Record<FidelityRisk, string> = {
  low: 'low risk',
  medium: 'medium risk',
  high: 'high risk',
}

/** A short, single-line preview of a source block (for the move description). */
function blockPreview(
  id: string,
  blocksById: Map<string, TransformerBlockView>,
): string {
  const block = blocksById.get(id)
  if (!block) return id
  const text = block.text.trim().replace(/\s+/g, ' ')
  if (!text) return id
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

export function ReorderAuditPanel({
  reorderings,
  blocksById,
}: {
  reorderings: ArticleReorderingAudit[] | undefined
  blocksById: Map<string, TransformerBlockView>
}) {
  const entries = reorderings ?? []

  return (
    <section className='panel tf-reorder-panel'>
      <h3 className='panel-h'>Reading order</h3>
      {entries.length === 0 ? (
        <p className='tf-reorder-empty'>Sections follow source order.</p>
      ) : (
        <ul className='tf-reorder-list'>
          {entries.map((r) => {
            const clusterCount = r.movedWithClusterIds?.length ?? 0
            return (
              <li key={r.sourceBlockId} className='tf-reorder-item'>
                <div className='tf-reorder-line'>
                  <span className='tf-reorder-block'>
                    Block “{blockPreview(r.sourceBlockId, blocksById)}”
                  </span>
                  <span className='tf-reorder-move'>
                    moved from position {r.fromIndex} → {r.toIndex}
                  </span>
                  <span className={`chip ${fidelityRiskChip(r.risk)}`}>
                    {RISK_LABEL[r.risk]}
                  </span>
                </div>
                <p className='tf-reorder-reason'>{r.reason}</p>
                {clusterCount > 0 && (
                  <p className='tf-reorder-cluster'>
                    moved with cluster ({clusterCount} block
                    {clusterCount === 1 ? '' : 's'})
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
