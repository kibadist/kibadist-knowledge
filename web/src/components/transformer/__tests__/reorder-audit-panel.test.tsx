import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ArticleReorderingAudit, TransformerBlockView } from '@/lib/api'
import { ReorderAuditPanel } from '../reorder-audit-panel'

/**
 * DET-275 reorder audit panel. Renders the source-order vs reading-order diff:
 * each entry shows the moved block (preview when block data is available, id
 * otherwise), its position move, a risk badge, the reason, and the cluster count;
 * an empty audit states that sections follow source order.
 */

function blocks(
  ...entries: { id: string; text: string }[]
): Map<string, TransformerBlockView> {
  const map = new Map<string, TransformerBlockView>()
  for (const e of entries) {
    map.set(e.id, {
      id: e.id,
      orderIndex: 0,
      blockType: 'PARAGRAPH',
      text: e.text,
      pageNumber: null,
      charStart: null,
      charEnd: null,
      classification: null,
      classificationStatus: 'pending',
      removable: false,
      noiseReason: null,
    })
  }
  return map
}

const audit = (
  over: Partial<ArticleReorderingAudit> & { sourceBlockId: string },
): ArticleReorderingAudit => ({
  fromIndex: 0,
  toIndex: 0,
  reason: 'r',
  risk: 'low',
  ...over,
})

describe('ReorderAuditPanel (DET-275)', () => {
  it('renders the empty state when there is no audit', () => {
    render(<ReorderAuditPanel reorderings={[]} blocksById={blocks()} />)
    expect(
      screen.getByText('Sections follow source order.'),
    ).toBeInTheDocument()
  })

  it('renders the empty state when reorderings is undefined', () => {
    render(<ReorderAuditPanel reorderings={undefined} blocksById={blocks()} />)
    expect(
      screen.getByText('Sections follow source order.'),
    ).toBeInTheDocument()
  })

  it('renders an entry with the block preview, move, risk badge and reason', () => {
    render(
      <ReorderAuditPanel
        reorderings={[
          audit({
            sourceBlockId: 'b1',
            fromIndex: 0,
            toIndex: 2,
            reason: 'Background reads better after the claim',
            risk: 'high',
          }),
        ]}
        blocksById={blocks({
          id: 'b1',
          text: 'Open-plan offices became popular.',
        })}
      />,
    )
    expect(
      screen.getByText(/Open-plan offices became popular\./),
    ).toBeInTheDocument()
    expect(screen.getByText(/moved from position 0 → 2/)).toBeInTheDocument()
    expect(screen.getByText('high risk')).toBeInTheDocument()
    expect(
      screen.getByText('Background reads better after the claim'),
    ).toBeInTheDocument()
  })

  it('falls back to the block id when no preview is available', () => {
    render(
      <ReorderAuditPanel
        reorderings={[audit({ sourceBlockId: 'b9' })]}
        blocksById={blocks()}
      />,
    )
    expect(screen.getByText(/Block “b9”/)).toBeInTheDocument()
  })

  it('surfaces the cluster count when a move carries movedWithClusterIds', () => {
    render(
      <ReorderAuditPanel
        reorderings={[
          audit({ sourceBlockId: 'b1', movedWithClusterIds: ['b2', 'b3'] }),
        ]}
        blocksById={blocks({ id: 'b1', text: 'A claim.' })}
      />,
    )
    expect(
      screen.getByText('moved with cluster (2 blocks)'),
    ).toBeInTheDocument()
  })
})
