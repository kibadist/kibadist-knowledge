'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'

import { InlineRuns } from '@/components/reader/inline-runs'
import {
  type ArticleEnrichment,
  api,
  type CaptureSource,
  type EditorialLayout,
  type IllustrationSuggestion,
} from '@/lib/api'
import {
  type ArticleBlockV2,
  type ArticleV2,
  blockPlainText,
  orderedSections,
  sectionKeyTerms,
} from '@/lib/article-v2'
import {
  buildEditorialPlan,
  type PlannedFigure,
  type StreamItem,
} from '@/lib/editorial-layout'
import {
  hasProvenanceContent,
  type SourceTrace,
  type SourceTraceIndex,
} from '@/lib/source-trace'

import './magazine-article.css'
import { ProvenancePanel } from './provenance-panel'
import { SourceTraceDrawer } from './source-trace-drawer'

const CAPTURE_LABEL: Record<CaptureSource, string> = {
  PASTE: 'Pasted text',
  URL: 'Web link',
  PDF: 'PDF',
}

const ILLUS_LABEL: Record<IllustrationSuggestion['illustrationType'], string> =
  {
    editorial_cover: 'Plate',
    decorative_section: 'Plate',
    source_based_diagram: 'Fig.',
  }

export interface MagazineArticleProps {
  article: ArticleV2
  /** Transformer article id — needed to fetch rendered illustration bytes. */
  articleId: string
  /** Illustration suggestions; only approved + rendered ones become plates. */
  illustrations?: IllustrationSuggestion[]
  /** AI world-knowledge extras (IPA, etymology, key facts). NOT source-grounded —
   *  every surfaced field carries a visible "not from your source" marker. */
  enrichment?: ArticleEnrichment | null
  /** Generative editorial furniture (kicker, standfirst, sub-heads, pull-quote,
   *  stat band, marginal notes, figure placements). Null on older articles; the
   *  layout engine derives a full Compendium layout deterministically without it. */
  editorialLayout?: EditorialLayout | null
  provenance?: {
    sourceUrl?: string | null
    captureSource?: CaptureSource | null
  }
  /** Source-trace index (DET-358). When present, paragraphs/callouts/tables become
   *  inspectable (hover/click → source-trace drawer) and a provenance appendix —
   *  claims, concepts, candidates, prompts, quality warnings — renders below the
   *  article. Absent ⇒ the reader renders exactly as before (pure presentation). */
  sourceTrace?: SourceTraceIndex | null
  /** Operator view: reveal raw source-block ids in the drawer (`?debug=1`). */
  debug?: boolean
}

/**
 * The Compendium render (DET-318) — a generated article presented as a
 * two-column, infobox-railed encyclopedia entry in the editorial-manuscript
 * brand. This is a *presentation* of the existing Article JSON v2: it maps the
 * blocks we already have onto the magazine vocabulary (headword, drop-cap lead,
 * § section bars, pull-quotes, marginalia, figure plates) and derives the rail
 * (contents, key-facts, see-also) from what the article carries. Encyclopedia
 * extras the schema doesn't model yet (IPA, etymology) are simply absent — the
 * layout reads cleanly without them, and the generator can fill them later.
 */
export function MagazineArticle({
  article,
  articleId,
  illustrations = [],
  enrichment,
  editorialLayout,
  provenance,
  sourceTrace,
  debug = false,
}: MagazineArticleProps) {
  // The open trace for the slide-in drawer (DET-358). A rendered block resolves
  // its trace by `block_id`; the appendix rows carry their trace directly.
  const [openTrace, setOpenTrace] = useState<SourceTrace | null>(null)
  const traces = sourceTrace?.byBlockId ?? null
  const showProvenance = sourceTrace ? hasProvenanceContent(sourceTrace) : false
  // The deterministic layout engine resolves the article + its editorial lanes
  // into a render-ready plan (DET-318): figures placed after each section's
  // opening paragraphs (never front-loaded), in-column vs span sized by type,
  // sequential figure numbers + (Fig. N) refs, two-part captions, and the
  // rhythm devices (drop-cap lead, one stat band, one pull-quote, marginalia)
  // spread to hit the cadence. The renderer below maps the plan 1:1 onto the
  // magazine vocabulary — all placement logic lives in the pure engine.
  const plan = useMemo(
    () =>
      buildEditorialPlan({
        article,
        illustrations,
        enrichment,
        editorialLayout,
      }),
    [article, illustrations, enrichment, editorialLayout],
  )

  // The stream sections (the abstract lede is lifted above the columns by the
  // plan; everything in `plan.sections` flows in the two-column body).
  const allSections = useMemo(() => orderedSections(article), [article])
  const sections = useMemo(() => {
    const inStream = new Set(plan.sections.map((s) => s.sectionId))
    return allSections.filter((s) => inStream.has(s.section_id))
  }, [allSections, plan.sections])

  const stats = useMemo(() => {
    let words = 0
    const terms = new Set<string>()
    for (const sec of sections) {
      for (const b of sec.blocks) {
        words += blockPlainText(b).split(/\s+/).filter(Boolean).length
      }
      for (const t of sectionKeyTerms(sec)) terms.add(t.term)
    }
    return {
      words,
      readMin: Math.max(1, Math.round(words / 220)),
      sectionCount: sections.length,
      terms: [...terms],
    }
  }, [sections])

  const host = hostOf(provenance?.sourceUrl ?? null)
  // `generated_at` can be absent/empty on older or adapted articles — never show
  // "Invalid Date"; omit the date (byline + infobox) when it doesn't parse.
  const generatedAt = new Date(article.generated_at)
  const date = Number.isNaN(generatedAt.getTime())
    ? null
    : generatedAt.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
  const captureLabel = provenance?.captureSource
    ? CAPTURE_LABEL[provenance.captureSource]
    : null

  return (
    <article className='kb-mag'>
      <ReadingProgress />

      <header className='kb-mag-head'>
        <div className='kb-mag-kicker'>
          {plan.kicker}
          {plan.kickerAi && <AiMark short />}
        </div>
        <h1 className='kb-mag-term'>{article.title}</h1>
        {(enrichment?.pronunciation || enrichment?.partOfSpeech) && (
          <div className='kb-mag-pronounce'>
            {enrichment.pronunciation && (
              <span className='ipa'>{enrichment.pronunciation}</span>
            )}
            {enrichment.partOfSpeech && (
              <span className='pos'>{enrichment.partOfSpeech}</span>
            )}
            <AiMark />
          </div>
        )}
        {enrichment?.etymology && (
          <p className='kb-mag-etym'>
            {enrichment.etymology} <AiMark />
          </p>
        )}
        <div className='kb-mag-byline'>
          <span className='author'>The Compendium</span>
          {host && (
            <>
              <span className='sep'>/</span>
              <a
                className='cat'
                href={provenance?.sourceUrl ?? undefined}
                target='_blank'
                rel='noopener noreferrer'
              >
                {host}
              </a>
            </>
          )}
          {date && (
            <>
              <span className='sep'>/</span>
              <span>{date}</span>
            </>
          )}
        </div>
      </header>

      <div className='kb-mag-folio'>
        <span className='ox'>Compendium</span>
        <span>
          {stats.sectionCount} section{stats.sectionCount === 1 ? '' : 's'}
        </span>
        <span>{stats.words.toLocaleString()} words</span>
        <span>{stats.readMin} min read</span>
        <span className='grow'>Source-grounded · earn what you keep</span>
      </div>

      {/* The faithful, source-grounded abstract lede (when present) sits full-
          width above the columns. A thin source has no abstract — the engine
          then supplies a generative standfirst, marked "not from your source". */}
      {plan.ledeParagraphs.length > 0 ? (
        <div className='kb-mag-lede'>
          {plan.ledeParagraphs.map((p) => {
            const it = interactiveTrace(traces?.get(p.blockId), setOpenTrace)
            return (
              <p
                key={p.blockId}
                id={p.blockId}
                className={it.className || undefined}
                {...it.handlers}
              >
                <InlineRuns runs={p.runs} />
                {it.flag}
              </p>
            )
          })}
        </div>
      ) : plan.standfirst ? (
        <div className='kb-mag-lede'>
          <p>
            {plan.standfirst.text}
            {plan.standfirst.ai && <AiMark />}
          </p>
        </div>
      ) : null}

      <div className='kb-mag-layout'>
        <div className='kb-mag-stream'>
          {/* Rendered from the deterministic editorial plan: each section is a
              § bar followed by its ORDERED stream items (blocks, figures placed
              after the opening paragraphs, and the spread rhythm devices). No
              front-loading — figures live inside their section. */}
          {plan.sections.map((section) => (
            <Fragment key={section.sectionId}>
              <div className='kb-mag-sec' id={section.sectionId}>
                <span className='num'>§ {pad(section.index)}</span>
                <h2>{section.heading}</h2>
              </div>
              {section.items.map((item, i) => (
                <StreamItemView
                  // biome-ignore lint/suspicious/noArrayIndexKey: device items have no id
                  key={itemKey(item, i)}
                  item={item}
                  articleId={articleId}
                  traces={traces}
                  onOpen={setOpenTrace}
                />
              ))}
            </Fragment>
          ))}
        </div>

        <aside className='kb-mag-rail'>
          <div className='kb-mag-infobox'>
            <div className='ib-head'>
              <div className='t'>{article.title}</div>
              <div className='s'>Compendium entry</div>
            </div>
            <div className='ib-sec'>Key facts</div>
            <dl>
              <InfoRow label='Sections' value={String(stats.sectionCount)} />
              {stats.terms.length > 0 && (
                <InfoRow label='Key terms' value={String(stats.terms.length)} />
              )}
              <InfoRow
                label='Length'
                value={`${stats.words.toLocaleString()} words`}
              />
              <InfoRow label='Reading' value={`${stats.readMin} min`} />
              {captureLabel && <InfoRow label='Source' value={captureLabel} />}
              {host && <InfoRow label='Origin' value={host} />}
              {date && <InfoRow label='Compiled' value={date} />}
            </dl>
            {enrichment?.keyFacts && enrichment.keyFacts.length > 0 && (
              <>
                <div className='ib-sec'>
                  Key facts <AiMark short />
                </div>
                <dl>
                  {enrichment.keyFacts.map((f) => (
                    <InfoRow
                      key={`${f.label}:${f.value}`}
                      label={f.label}
                      value={f.value}
                    />
                  ))}
                </dl>
              </>
            )}
          </div>

          {sections.length > 1 && (
            <nav className='kb-mag-toc' aria-label='Contents'>
              <div className='th'>Contents</div>
              <ol>
                {sections.map((s, i) => (
                  <li key={s.section_id}>
                    <a href={`#${s.section_id}`}>
                      <span className='rn'>{pad(i + 1)}</span>
                      <span>{s.heading}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {stats.terms.length > 0 && (
            <div className='kb-mag-seealso'>
              <div className='th'>See also</div>
              <div className='chips'>
                {stats.terms.slice(0, 10).map((t) => (
                  <span key={t} className='chip'>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className='kb-mag-colophon'>
        <p>
          Compiled by the Kibadist Compendium from your source. The article is a
          worked example to read — <em>you earn the knowledge</em> by recalling
          and explaining it in the Exercise tab.
        </p>
        <div className='foot'>
          <span>Kibadist Compendium</span>
          <span>Source-grounded · light-only</span>
        </div>
      </div>

      {/* Provenance appendix (DET-358): claims, concepts, candidates, prompts and
          quality warnings — each opens the same source-trace drawer the inline
          blocks use. Only rendered when there is provenance to show. */}
      {sourceTrace && showProvenance && (
        <ProvenancePanel index={sourceTrace} onInspect={setOpenTrace} />
      )}

      <SourceTraceDrawer
        trace={openTrace}
        debug={debug}
        onClose={() => setOpenTrace(null)}
      />
    </article>
  )
}

/**
 * Resolve the interactive props for a rendered block from its source trace
 * (DET-358). Returns the class to append, the DOM handlers (click + keyboard +
 * a11y role), and an inline flag node for unsupported blocks so a broken
 * traceability link is visible without interaction. A block with no trace (or no
 * index) is inert — the reader renders exactly as before.
 */
function interactiveTrace(
  trace: SourceTrace | undefined,
  onOpen: (trace: SourceTrace) => void,
): {
  className: string
  flag: React.ReactNode
  handlers: Record<string, unknown>
} {
  if (!trace) return { className: '', flag: null, handlers: {} }
  const highRisk = trace.fidelityRisk === 'high' || trace.confidence === 'low'
  const className = `kb-mag-traceable${
    trace.unsupported ? ' is-unsupported' : highRisk ? ' is-highrisk' : ''
  }`
  const open = () => onOpen(trace)
  const handlers: Record<string, unknown> = {
    role: 'button',
    tabIndex: 0,
    'aria-label': `Inspect source for this ${trace.label.toLowerCase()}`,
    'data-trace-block': trace.id,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    },
  }
  const flag = trace.unsupported ? (
    <span className='kb-mag-traceflag'> ⚑ unsupported</span>
  ) : null
  return { className, flag, handlers }
}

/** The honesty marker for AI world-knowledge that is NOT grounded in the user's
 *  source — a hard product requirement wherever enrichment appears. `short` is
 *  the compact "✦ AI" used where space is tight (e.g. the infobox header). */
function AiMark({ short }: { short?: boolean }) {
  return (
    <span className='kb-mag-aimark'>
      {short ? '✦ AI' : '✦ AI · not from your source'}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='row'>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Render one planned stream item onto the magazine vocabulary. The plan has
 *  already decided placement, sizing, and the rhythm devices — this is a pure
 *  1:1 mapping. */
function StreamItemView({
  item,
  articleId,
  traces,
  onOpen,
}: {
  item: StreamItem
  articleId: string
  /** Per-block source traces (DET-358); null when provenance is off. */
  traces: Map<string, SourceTrace> | null
  onOpen: (trace: SourceTrace) => void
}) {
  switch (item.kind) {
    case 'block':
      return (
        <MagazineBlock
          block={item.block}
          isLead={item.isLead ?? false}
          figureRef={item.figureRef}
          trace={traces?.get(item.block.block_id)}
          onOpen={onOpen}
        />
      )
    case 'figure':
      return <IllustrationPlate articleId={articleId} figure={item.figure} />
    case 'subhead':
      // An inline sub-head break for long sections (cadence rule).
      return <h3>{item.text}</h3>
    case 'statband':
      return (
        <div
          className='kb-mag-statband'
          style={{ '--cols': item.stats.length } as React.CSSProperties}
        >
          {item.stats.map((s) => (
            <div className='s' key={`${s.figure}:${s.label}`}>
              <div className='n'>{s.figure}</div>
              <div className='d'>
                {s.label}
                {item.ai && <AiMark short />}
              </div>
            </div>
          ))}
        </div>
      )
    case 'pullquote':
      return (
        <blockquote className='kb-mag-pull'>
          <p>{item.text}</p>
          {(item.attribution || item.ai) && (
            <div className='attrib'>
              {item.attribution}
              {item.ai && <AiMark short />}
            </div>
          )}
        </blockquote>
      )
    case 'marginal':
      return (
        <div className='kb-mag-marginal'>
          <span className='mh'>
            {item.title}
            {item.ai && <AiMark short />}
          </span>
          {item.text}
        </div>
      )
  }
}

/** A stable-ish key for a stream item: block id when present, else kind+index. */
function itemKey(item: StreamItem, i: number): string {
  if (item.kind === 'block') return item.block.block_id
  if (item.kind === 'figure') return `fig-${item.figure.suggestion.id}`
  return `${item.kind}-${i}`
}

/** One Article-JSON-v2 block in the magazine vocabulary. */
function MagazineBlock({
  block,
  isLead,
  figureRef,
  trace,
  onOpen,
}: {
  block: ArticleBlockV2
  isLead: boolean
  /** Figure number to bind as a trailing `(Fig. N)` reference (figure↔prose). */
  figureRef?: number
  /** Source trace for this block (DET-358); undefined ⇒ inert (no affordance). */
  trace?: SourceTrace
  onOpen: (trace: SourceTrace) => void
}) {
  // The interactive props (class, handlers, unsupported flag) when this block
  // carries a trace; all empty/inert when it doesn't, so the render is unchanged.
  const it = interactiveTrace(trace, onOpen)
  const cls = (base?: string) =>
    [base, it.className].filter(Boolean).join(' ') || undefined

  switch (block.type) {
    case 'paragraph':
      return (
        <p
          className={cls(isLead ? 'kb-mag-lead' : undefined)}
          id={block.block_id}
          {...it.handlers}
        >
          <InlineRuns runs={block.content.runs} />
          {figureRef !== undefined && (
            <span className='kb-mag-figref'> (Fig. {figureRef})</span>
          )}
          {it.flag}
        </p>
      )
    case 'heading':
      // Section titles come from `section.heading` (§ bars); heading blocks are
      // in-column sub-heads.
      return (
        <h3 className={cls()} id={block.block_id} {...it.handlers}>
          <InlineRuns runs={block.content.runs} />
        </h3>
      )
    case 'list': {
      const items = block.content.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id
        <li key={i}>
          <InlineRuns runs={item} />
        </li>
      ))
      return block.content.ordered ? (
        <ol className={cls()} id={block.block_id} {...it.handlers}>
          {items}
        </ol>
      ) : (
        <ul className={cls()} id={block.block_id} {...it.handlers}>
          {items}
        </ul>
      )
    }
    case 'quote':
      // A quote becomes the pull-quote — the magazine's spanning display device.
      return (
        <blockquote
          className={cls('kb-mag-pull')}
          id={block.block_id}
          {...it.handlers}
        >
          <p>
            <InlineRuns runs={block.content.runs} />
          </p>
          {block.content.attribution && (
            <div className='attrib'>{block.content.attribution}</div>
          )}
        </blockquote>
      )
    case 'callout':
      // An aside becomes a marginal note (the mono side-note).
      return (
        <div
          className={cls('kb-mag-marginal')}
          id={block.block_id}
          {...it.handlers}
        >
          <span className='mh'>
            {block.content.title ?? block.content.variant ?? 'Note'}
          </span>
          <InlineRuns runs={block.content.runs} />
          {it.flag}
        </div>
      )
    case 'table': {
      const rows = block.content.rows
      if (rows.length === 0) return null
      const [head, ...body] = block.content.header ? rows : [null, ...rows]
      return (
        <table className={cls()} id={block.block_id} {...it.handlers}>
          {head && (
            <thead>
              <tr>
                {head.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, ri) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id
              <tr key={ri}>
                {(row ?? []).map((c, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id
                  <td key={ci}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'code':
      return (
        <pre className={cls()} id={block.block_id} {...it.handlers}>
          <code>{block.content.text}</code>
        </pre>
      )
    case 'image':
      return (
        <figure className='kb-mag-plate' id={block.block_id}>
          <div className='frame'>
            <span className='figtag'>Plate</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.content.src} alt={block.content.alt ?? ''} />
          </div>
          {block.content.caption && (
            <figcaption>{block.content.caption}</figcaption>
          )}
        </figure>
      )
    case 'divider':
      return null
  }
}

/** A planned figure as a captioned plate (authed blob fetch). The plan decides
 *  size (`span` hero vs in-column `Fig.`), figure number, and the two-part
 *  teaching caption; this component only fetches the bytes and renders. */
function IllustrationPlate({
  articleId,
  figure,
}: {
  articleId: string
  figure: PlannedFigure
}) {
  const { suggestion, size, figureNumber, caption } = figure
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const generatedAt = suggestion.image?.generatedAt

  useEffect(() => {
    let url: string | null = null
    let active = true
    setSrc(null)
    setFailed(false)
    api
      .getIllustrationImageBlob(articleId, suggestion.id)
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [articleId, suggestion.id, generatedAt])

  // The figtag is the in-prose handle: a span hero reads "Plate", an in-column
  // diagram reads "Fig. N" so the (Fig. N) prose ref resolves to it.
  const figtag =
    size === 'column'
      ? `${ILLUS_LABEL[suggestion.illustrationType]} ${figureNumber}`
      : ILLUS_LABEL[suggestion.illustrationType]

  return (
    <figure className={`kb-mag-plate${size === 'span' ? ' is-span' : ''}`}>
      <div className='frame'>
        <span className='figtag'>{figtag}</span>
        {failed ? (
          <div className='ph'>Illustration unavailable</div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={suggestion.caption} />
        ) : (
          <div className='ph'>Rendering…</div>
        )}
      </div>
      {(caption.takeaway || caption.detail) && (
        <figcaption>
          {figure.ai && <span className='aichip'>✦ AI</span>}
          {caption.takeaway && <b>{caption.takeaway}.</b>}
          {caption.detail && ` ${caption.detail}`}
        </figcaption>
      )}
    </figure>
  )
}

/** Reading-progress hairline driven by window scroll. */
function ReadingProgress() {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className='kb-mag-progress' style={{ width: `${pct}%` }} aria-hidden />
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
