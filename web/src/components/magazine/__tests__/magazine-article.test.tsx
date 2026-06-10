import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { IllustrationSuggestion, InlineRun } from '@/lib/api'
import type {
  ArticleBlockV2,
  ArticleSectionV2,
  ArticleV2,
} from '@/lib/article-v2'
import { ARTICLE_JSON_V2 } from '@/lib/article-v2'

// The plate fetches image bytes via an authed blob call — stub it so no network
// happens. The promise never resolves in the test; we assert the synchronous
// structure (figtag, caption, span vs column) that the plan drives.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getIllustrationImageBlob: vi.fn(() => new Promise<Blob>(() => {})),
    },
  }
})

import { MagazineArticle } from '../magazine-article'

function run(text: string): InlineRun[] {
  return [{ text }]
}
function para(text: string, id: string): ArticleBlockV2 {
  return {
    block_id: id,
    section_id: '',
    order_index: 0,
    type: 'paragraph',
    content: { runs: run(text) },
  }
}
function section(
  id: string,
  heading: string,
  blocks: ArticleBlockV2[],
  order = 0,
): ArticleSectionV2 {
  return {
    section_id: id,
    heading,
    order_index: order,
    blocks: blocks.map((b, i) => ({ ...b, section_id: id, order_index: i })),
  }
}
function article(sections: ArticleSectionV2[]): ArticleV2 {
  return {
    article_id: 'a1',
    source_id: 's1',
    schema_version: ARTICLE_JSON_V2,
    title: 'Photosynthesis',
    generated_at: '2026-01-01T00:00:00Z',
    sections,
  }
}
function illus(
  over: Partial<IllustrationSuggestion> &
    Pick<IllustrationSuggestion, 'id' | 'illustrationType'>,
): IllustrationSuggestion {
  return {
    purpose: 'p',
    visualDescription: 'v',
    caption: 'A caption.',
    fidelityRisk: 'low' as IllustrationSuggestion['fidelityRisk'],
    reason: 'r',
    sourceBlockIds: [],
    approval: 'approved',
    image: {
      width: 1,
      height: 1,
      provider: 'openai',
      model: 'm',
      generatedAt: '2026-01-01T00:00:00Z',
    },
    ...over,
  }
}

describe('MagazineArticle (plan-driven render)', () => {
  it('does not front-load a cover; the first stream child is prose, the figure follows', () => {
    const a = article([
      section('sec-1', 'Intro', [
        para('Opening one.', 'b1'),
        para('Opening two.', 'b2'),
        para('Body three.', 'b3'),
      ]),
    ])
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        illustrations={[
          illus({
            id: 'cover',
            illustrationType: 'editorial_cover',
            sourceBlockIds: [],
          }),
        ]}
      />,
    )
    const stream = container.querySelector('.kb-mag-stream')
    expect(stream).toBeTruthy()
    const children = Array.from(stream?.children ?? [])
    // First child is the § section bar, second is a paragraph — NOT a figure.
    expect(children[0].className).toContain('kb-mag-sec')
    const firstFigureIdx = children.findIndex((c) =>
      c.classList.contains('kb-mag-plate'),
    )
    const firstParaIdx = children.findIndex((c) => c.tagName === 'P')
    expect(firstParaIdx).toBeGreaterThan(-1)
    expect(firstFigureIdx).toBeGreaterThan(firstParaIdx)
  })

  it('renders a source_based_diagram in-column (no is-span) with a numbered Fig. tag', () => {
    const a = article([
      section('sec-1', 'Intro', [
        para('Opening one.', 'b1'),
        para('Opening two.', 'b2'),
        para('Body three.', 'b3'),
      ]),
    ])
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        illustrations={[
          illus({
            id: 'diagram',
            illustrationType: 'source_based_diagram',
            sourceBlockIds: ['b1'],
            caption: 'The cycle turns. Light drives it forward.',
          }),
        ]}
      />,
    )
    const plate = container.querySelector('.kb-mag-plate')
    expect(plate).toBeTruthy()
    // In-column: the span modifier is absent.
    expect(plate?.classList.contains('is-span')).toBe(false)
    // Figtag carries the figure number for the (Fig. N) prose ref to resolve to.
    expect(within(plate as HTMLElement).getByText('Fig. 1')).toBeTruthy()
    // Two-part caption: a bold takeaway + the detail sentence.
    const bold = plate?.querySelector('figcaption b')
    expect(bold?.textContent).toBe('The cycle turns.')
    // A (Fig. 1) reference binds to a paragraph in the stream.
    expect(container.textContent).toContain('(Fig. 1)')
  })

  it('renders a cover/decorative as a full-width span hero', () => {
    const a = article([
      section('sec-1', 'Intro', [
        para('Opening one.', 'b1'),
        para('Opening two.', 'b2'),
        para('Body three.', 'b3'),
      ]),
    ])
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        illustrations={[
          illus({
            id: 'cover',
            illustrationType: 'editorial_cover',
            sourceBlockIds: ['b1'],
          }),
        ]}
      />,
    )
    const plate = container.querySelector('.kb-mag-plate')
    expect(plate?.classList.contains('is-span')).toBe(true)
  })

  it('renders the kicker from the plan and marks an AI standfirst', () => {
    const a = article([section('sec-1', 'A', [para('Body.', 'b1')])])
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        editorialLayout={{
          kicker: { text: 'Field Notes', grounded: false },
          standfirst: { text: 'A generated lede.', grounded: false },
        }}
      />,
    )
    expect(screen.getByText('Field Notes')).toBeTruthy()
    expect(screen.getByText('A generated lede.')).toBeTruthy()
    // The honesty marker appears for ungrounded furniture.
    expect(
      screen.getAllByText(/not from your source|✦ AI/).length,
    ).toBeGreaterThan(0)
  })
})
