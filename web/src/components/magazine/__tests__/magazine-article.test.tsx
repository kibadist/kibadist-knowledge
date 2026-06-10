import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  IllustrationSuggestion,
  InlineRun,
  TransformerBlockView,
} from '@/lib/api'
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

function sourceBlock(
  id: string,
  text: string,
  over: Partial<TransformerBlockView> = {},
): TransformerBlockView {
  return {
    id,
    orderIndex: 0,
    blockType: 'PARAGRAPH',
    text,
    pageNumber: null,
    charStart: null,
    charEnd: null,
    classification: null,
    classificationStatus: 'CLASSIFIED',
    removable: false,
    noiseReason: null,
    ...over,
  }
}

describe('MagazineArticle citations (DET-318)', () => {
  const cited = article([
    section('sec-1', 'Intro', [
      { ...para('Cited prose.', 'b1'), source_span_ids: ['src-1'] },
      para('Uncited prose.', 'b2'),
    ]),
  ])

  it('marks cited paragraphs and never fabricates a marker for uncited ones', () => {
    const { container } = render(
      <MagazineArticle
        article={cited}
        articleId='art-1'
        sourceBlocks={[sourceBlock('src-1', 'The original sentence.')]}
      />,
    )
    const citedPara = container.querySelector('#b1')
    const uncitedPara = container.querySelector('#b2')
    expect(citedPara?.querySelector('.kb-mag-cite')).toBeTruthy()
    expect(uncitedPara?.querySelector('.kb-mag-cite')).toBeFalsy()
  })

  it('opens a popover with the exact source passage on click', () => {
    render(
      <MagazineArticle
        article={cited}
        articleId='art-1'
        sourceBlocks={[sourceBlock('src-1', 'The original sentence.')]}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: /citation 1 — show source passage/i,
      }),
    )
    expect(screen.getByText('The original sentence.')).toBeTruthy()
  })

  it('hands "Open in Source" the cited source block id', () => {
    const onOpenSource = vi.fn()
    render(
      <MagazineArticle
        article={cited}
        articleId='art-1'
        sourceBlocks={[sourceBlock('src-1', 'The original sentence.')]}
        onOpenSource={onOpenSource}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: /citation 1 — show source passage/i,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /open in source/i }))
    expect(onOpenSource).toHaveBeenCalledWith('src-1')
  })

  it('degrades honestly when the cited passage is not in the pinned blocks', () => {
    render(<MagazineArticle article={cited} articleId='art-1' />)
    fireEvent.click(
      screen.getByRole('button', {
        name: /citation 1 — show source passage/i,
      }),
    )
    expect(screen.getByText(/original passage unavailable/i)).toBeTruthy()
  })

  it('renders a Sources colophon with provenance and the cited-passage count', () => {
    const { container } = render(
      <MagazineArticle
        article={cited}
        articleId='art-1'
        sourceBlocks={[sourceBlock('src-1', 'The original sentence.')]}
        provenance={{
          sourceUrl: 'https://example.org/essay',
          captureSource: 'URL',
        }}
      />,
    )
    const sources = container.querySelector('.kb-mag-sources')
    expect(sources).toBeTruthy()
    expect(within(sources as HTMLElement).getByText('example.org')).toBeTruthy()
    expect(sources?.textContent).toContain('1 passage cited')
  })
})

describe('MagazineArticle definitions + key concepts (DET-319)', () => {
  const a = article([
    section('sec-1', 'Intro', [
      { ...para('Opening one.', 'b1'), source_span_ids: ['src-1'] },
      para('Opening two.', 'b2'),
      para('Body three.', 'b3'),
    ]),
  ])

  it('typesets a source-grounded definition card with its citation marker', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        terminology={[
          {
            term: 'Vector',
            definition: 'A magnitude with direction.',
            sourceBlockIds: ['src-1'],
          },
        ]}
        sourceBlocks={[sourceBlock('src-1', 'Original definition passage.')]}
      />,
    )
    const card = container.querySelector('.kb-mag-defcard')
    expect(card).toBeTruthy()
    expect(within(card as HTMLElement).getByText('Vector')).toBeTruthy()
    expect(
      within(card as HTMLElement).getByText(/a magnitude with direction/i),
    ).toBeTruthy()
    // The card carries the same provenance marker vocabulary as prose.
    expect(card?.querySelector('.kb-mag-cite')).toBeTruthy()
  })

  it('offers "Save as Concept" on a pending candidate and reports it', () => {
    const onValidateCandidate = vi.fn()
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        conceptCandidates={[
          {
            id: 'cand-1',
            sectionId: 'sec-1',
            label: 'Eigenvector',
            definition: 'A vector a transformation only scales.',
            sourceBlockIds: ['src-1'],
            aiAssisted: true,
            validationStatus: 'pending',
          },
        ]}
        onValidateCandidate={onValidateCandidate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save as concept/i }))
    expect(onValidateCandidate).toHaveBeenCalledTimes(1)
    expect(onValidateCandidate.mock.calls[0][0].id).toBe('cand-1')
  })

  it('shows a validated candidate as already kept (no action)', () => {
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        conceptCandidates={[
          {
            id: 'cand-1',
            sectionId: 'sec-1',
            label: 'Eigenvector',
            definition: 'A vector a transformation only scales.',
            sourceBlockIds: ['src-1'],
            aiAssisted: true,
            validationStatus: 'validated',
            conceptId: 'concept-9',
          },
        ]}
        onValidateCandidate={vi.fn()}
      />,
    )
    expect(screen.getByText(/in your concepts/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save as concept/i })).toBe(
      null,
    )
  })
})

describe('MagazineArticle inline retrieval prompts (DET-321)', () => {
  const a = article([
    section('sec-1', 'Intro', [
      { ...para('Cited prose.', 'b1'), source_span_ids: ['src-1'] },
    ]),
  ])
  const prompt = {
    id: 'rp-1',
    prompt: 'What does the source say about vectors?',
    sourceBlockIds: ['src-1'],
    promptType: 'recall' as const,
    difficulty: 'medium' as const,
  }

  it('keeps the source passage hidden until the learner attempts the prompt', () => {
    const onPromptAttempt = vi.fn()
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        retrievalPrompts={[prompt]}
        sourceBlocks={[sourceBlock('src-1', 'The source passage answer.')]}
        onPromptAttempt={onPromptAttempt}
      />,
    )
    expect(
      screen.getByText('What does the source say about vectors?'),
    ).toBeTruthy()
    expect(screen.queryByText('The source passage answer.')).toBe(null)
    fireEvent.click(
      screen.getByRole('button', { name: /answer in your head/i }),
    )
    expect(screen.getByText('The source passage answer.')).toBeTruthy()
    expect(onPromptAttempt).toHaveBeenCalledTimes(1)
    expect(onPromptAttempt.mock.calls[0][0].id).toBe('rp-1')
  })

  it('renders the prompt typology label', () => {
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        retrievalPrompts={[prompt]}
      />,
    )
    expect(screen.getByText('Recall')).toBeTruthy()
    expect(screen.getByText(/medium/)).toBeTruthy()
  })

  it('renders untyped legacy prompts unchanged (as a plain self-test)', () => {
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        retrievalPrompts={[
          { id: 'rp-old', prompt: 'Old prompt?', sourceBlockIds: ['src-1'] },
        ]}
      />,
    )
    expect(screen.getByText('Old prompt?')).toBeTruthy()
    expect(screen.getByText('Self-test')).toBeTruthy()
  })
})

describe('MagazineArticle strict vs enhanced (DET-323)', () => {
  const a = article([
    section('sec-1', 'Intro', [
      para('One.', 'b1'),
      para('Two.', 'b2'),
      para('Three.', 'b3'),
    ]),
  ])
  const aiProps = {
    enrichment: {
      pronunciation: '/ˈtɛst/',
      partOfSpeech: 'noun',
      etymology: 'From testing.',
      classification: 'AI Category',
      keyFacts: [{ label: 'Fact', value: 'Value' }],
    },
    editorialLayout: {
      kicker: { text: 'AI Kicker', grounded: false },
      standfirst: { text: 'AI lede.', grounded: false },
      marginalNotes: [
        {
          sectionId: 'sec-1',
          afterParagraphIndex: 1,
          title: 'AI note',
          text: 'Not from the source.',
          grounded: false,
        },
      ],
    },
    illustrations: [
      illus({ id: 'cover', illustrationType: 'editorial_cover' }),
    ],
    conceptCandidates: [
      {
        id: 'c1',
        sectionId: 'sec-1',
        label: 'L',
        definition: 'D',
        sourceBlockIds: ['b1'],
        aiAssisted: true as const,
        validationStatus: 'pending' as const,
      },
    ],
  }

  it('strict renders zero ✦ AI-marked elements', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        {...aiProps}
        aiAssistMode='strict'
      />,
    )
    expect(container.querySelectorAll('.kb-mag-aimark')).toHaveLength(0)
    expect(container.textContent).not.toContain('✦ AI')
    expect(container.querySelector('.kb-mag-plate')).toBeFalsy()
    expect(container.querySelector('.kb-mag-concept')).toBeFalsy()
    expect(container.textContent).not.toContain('From testing.')
  })

  it('switching back to enhanced restores the AI surfaces from the same props', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        {...aiProps}
        aiAssistMode='enhanced'
      />,
    )
    expect(container.querySelectorAll('.kb-mag-aimark').length).toBeGreaterThan(
      0,
    )
    expect(container.textContent).toContain('From testing.')
    expect(container.querySelector('.kb-mag-concept')).toBeTruthy()
  })
})

describe('MagazineArticle folio fidelity + difficulty (DET-324)', () => {
  const a = article([section('sec-1', 'Intro', [para('One.', 'b1')])])

  it('shows the fidelity score on a passing article', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        fidelity={{ score: 94, blocked: false }}
      />,
    )
    const fid = container.querySelector('.kb-mag-folio .fid')
    expect(fid?.textContent).toContain('Fidelity 94')
  })

  it('omits the number when the score is missing (old articles)', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        fidelity={{ score: null, blocked: false }}
      />,
    )
    expect(
      container.querySelector('.kb-mag-folio .fid')?.textContent,
    ).toContain('Fidelity checked')
  })

  it('escalates a BLOCKED article into the Inspector', () => {
    const onInspectFidelity = vi.fn()
    render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        fidelity={{ score: 41, blocked: true }}
        onInspectFidelity={onInspectFidelity}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /held by fidelity/i }))
    expect(onInspectFidelity).toHaveBeenCalledTimes(1)
  })

  it('shows no status line at all without the fidelity prop', () => {
    const { container } = render(
      <MagazineArticle article={a} articleId='art-1' />,
    )
    expect(container.querySelector('.kb-mag-folio .fid')).toBeFalsy()
  })

  it('shows the AI-judged difficulty with the honesty mark', () => {
    const { container } = render(
      <MagazineArticle
        article={a}
        articleId='art-1'
        enrichment={{ difficulty: 'intermediate' }}
      />,
    )
    const diff = container.querySelector('.kb-mag-folio .diff')
    expect(diff?.textContent).toContain('intermediate')
    expect(diff?.querySelector('.kb-mag-aimark')).toBeTruthy()
  })
})

describe('MagazineArticle equations (DET-322)', () => {
  function equation(latex: string, id: string): ArticleBlockV2 {
    return {
      block_id: id,
      section_id: '',
      order_index: 0,
      type: 'equation',
      content: { latex, status: 'verbatim' },
      source_span_ids: ['src-1'],
    }
  }

  it('typesets a valid equation with KaTeX, never split across columns', () => {
    const a = article([
      section('sec-1', 'Math', [
        para('Prose first.', 'b1'),
        equation('E = mc^2', 'eq1'),
      ]),
    ])
    const { container } = render(
      <MagazineArticle article={a} articleId='art-1' />,
    )
    const eq = container.querySelector('.kb-mag-eq')
    expect(eq).toBeTruthy()
    expect(eq?.querySelector('.katex')).toBeTruthy()
  })

  it('falls back to the raw notation when the LaTeX does not parse', () => {
    const a = article([
      section('sec-1', 'Math', [
        para('Prose first.', 'b1'),
        equation('\\frac{unclosed', 'eq1'),
      ]),
    ])
    const { container } = render(
      <MagazineArticle article={a} articleId='art-1' />,
    )
    expect(container.querySelector('.kb-mag-eq')).toBeFalsy()
    const raw = container.querySelector('.kb-mag-eq-raw')
    expect(raw).toBeTruthy()
    expect(raw?.textContent).toContain('\\frac{unclosed')
  })
})

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
