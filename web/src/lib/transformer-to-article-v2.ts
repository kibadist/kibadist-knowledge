import type {
  ArticleCallout,
  ArticleJsonV2 as TransformerArticle,
  ArticleBlock as TransformerBlock,
  ArticleSectionV2 as TransformerSection,
} from './api'
import {
  ARTICLE_JSON_V2,
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  type CalloutVariant,
  type KeyTermRef,
} from './article-v2'

/**
 * Adapt the transformer's rich, magazine-shaped article (`ArticleJsonV2` in
 * `lib/api.ts`, the wire shape of a FINAL/BLOCKED transformed article) into the
 * learning-mode `ArticleV2` contract (`lib/article-v2.ts`) that Deep Reading
 * Mode and every exercise mode consume (DET-301).
 *
 * The two shapes look alike but are NOT the same: the transformer shape carries
 * `title.text`, a separate `abstract`, nested `subsections`, `text`-bearing
 * blocks, and placed key-term callouts; the learning contract wants a flat list
 * of sections whose text blocks carry `InlineRun[]` content and whose key terms
 * are section-scoped (DET-278). This is the single adaptation boundary — the
 * server still owns the v1→v2 transformer adaptation; this only re-shapes the
 * already-v2 transformer article for the reading surface.
 *
 * IDs are taken verbatim from the persisted transformer article (section/block
 * `id`), so learning events anchor to the same stable ids the source inspector
 * uses (DET-278 rule #1). The article id is the TransformedArticle row id.
 */
export interface TransformerToV2Options {
  /** The TransformedArticle row id — the stable `article_id` events anchor to. */
  articleId: string
  /** The source document id behind this article. */
  sourceId: string
  /** When the article version was generated, if known (ISO-8601). */
  generatedAt?: string
}

export function transformerArticleToV2(
  article: TransformerArticle,
  { articleId, sourceId, generatedAt }: TransformerToV2Options,
): ArticleV2 {
  // Placed key-term callouts (DET-272) are the closest thing the transformer has
  // to section-scoped key terms — use them to light up the overview skeleton.
  const keyTermsBySection = article.calloutPlacements?.bySection ?? {}

  const sections: ArticleSectionV2[] = []
  let sectionOrder = 0

  const pushSection = (
    sectionId: string,
    heading: string,
    blocks: TransformerBlock[],
    sourceBlockIds: string[],
  ) => {
    const section: ArticleSectionV2 = {
      section_id: sectionId,
      heading,
      order_index: sectionOrder++,
      source_span_ids: sourceBlockIds,
      key_terms: keyTermRefsFor(keyTermsBySection[sectionId]),
      blocks: mapBlocks(blocks, sectionId),
    }
    sections.push(section)
  }

  // The transformer keeps the source summary in a separate `abstract`; surface it
  // as a leading section so it reads (and can be learned from) like the rest.
  if (article.abstract.length > 0) {
    pushSection(
      `${articleId}-abstract`,
      article.subtitle?.text ? article.subtitle.text : 'Overview',
      article.abstract.map((p) => ({
        id: p.id,
        type: 'paragraph' as const,
        text: p.text,
        sourceBlockIds: p.sourceBlockIds,
        transformationType: p.transformationType,
        fidelityRisk: p.fidelityRisk,
      })),
      article.abstract.flatMap((p) => p.sourceBlockIds),
    )
  }

  // Flatten subsections one level: each becomes its own section right after its
  // parent, keeping reading order and its own heading (the contract has no
  // nesting). Their key terms / events still anchor to the subsection id.
  const walk = (section: TransformerSection) => {
    pushSection(
      section.id,
      section.heading,
      section.blocks,
      section.sourceBlockIds,
    )
    for (const sub of section.subsections ?? []) walk(sub)
  }
  for (const section of article.sections) walk(section)

  return {
    article_id: articleId,
    source_id: sourceId,
    schema_version: ARTICLE_JSON_V2,
    title: article.title.text,
    generated_at: generatedAt ?? '',
    sections,
  }
}

/** Placed key-term callouts → the contract's section key terms (deduped later). */
function keyTermRefsFor(
  callouts: ArticleCallout[] | undefined,
): KeyTermRef[] | undefined {
  if (!callouts) return undefined
  const refs: KeyTermRef[] = []
  for (const c of callouts) {
    if (c.kind !== 'keyTerm') continue
    const term = (c.term ?? c.text).trim()
    if (term) refs.push({ term })
  }
  return refs.length > 0 ? refs : undefined
}

function mapBlocks(
  blocks: TransformerBlock[],
  sectionId: string,
): ArticleBlockV2[] {
  const out: ArticleBlockV2[] = []
  let order = 0
  for (const block of blocks) {
    const mapped = mapBlock(block, sectionId, order)
    if (mapped) {
      out.push(mapped)
      order++
    }
  }
  return out
}

// The transformer callout types are free-form strings; map the ones that line up
// with the contract's closed variant set, else fall back to a neutral note.
const CALLOUT_VARIANTS: ReadonlySet<CalloutVariant> = new Set([
  'note',
  'tip',
  'warning',
  'insight',
])

function mapBlock(
  block: TransformerBlock,
  sectionId: string,
  orderIndex: number,
): ArticleBlockV2 | null {
  const base = {
    block_id: block.id,
    section_id: sectionId,
    order_index: orderIndex,
    source_span_ids: block.sourceBlockIds,
  }
  switch (block.type) {
    case 'paragraph':
      return {
        ...base,
        type: 'paragraph',
        content: { runs: [{ text: block.text }] },
      }
    case 'list':
      return {
        ...base,
        type: 'list',
        content: {
          ordered: block.ordered,
          items: block.items.map((item) => [{ text: item }]),
        },
      }
    case 'quote':
      return {
        ...base,
        type: 'quote',
        content: {
          runs: [{ text: block.text }],
          ...(block.attribution ? { attribution: block.attribution } : {}),
        },
      }
    // The contract has no pull-quote; render it as a quote so the excerpt reads.
    case 'pullQuote':
      return {
        ...base,
        type: 'quote',
        content: { runs: [{ text: block.text }] },
      }
    case 'table':
      return {
        ...base,
        type: 'table',
        content: {
          header: Boolean(block.header && block.header.length > 0),
          rows: block.header ? [block.header, ...block.rows] : block.rows,
        },
      }
    case 'code':
      return {
        ...base,
        type: 'code',
        content: {
          ...(block.language ? { language: block.language } : {}),
          text: block.text,
        },
      }
    // A source equation carries through verbatim (DET-322) — the renderer owns
    // the typesetting; the LaTeX is the block's plain text for learning modes.
    case 'equation':
      return {
        ...base,
        type: 'equation',
        content: { latex: block.latex, status: block.equationStatus },
      }
    case 'callout': {
      const variant =
        block.calloutType &&
        CALLOUT_VARIANTS.has(block.calloutType as CalloutVariant)
          ? (block.calloutType as CalloutVariant)
          : 'note'
      return {
        ...base,
        type: 'callout',
        content: {
          variant,
          ...(block.title ? { title: block.title } : {}),
          runs: [{ text: block.text }],
        },
      }
    }
    // A figure anchor is metadata only (the illustration system owns inline
    // figures); it carries no readable text body, so it has no learning surface.
    case 'figureAnchor':
      return null
    default:
      return null
  }
}
