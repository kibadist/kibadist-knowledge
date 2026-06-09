'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'

import { InlineRuns } from '@/components/reader/inline-runs'
import {
  type ArticleEnrichment,
  api,
  type CaptureSource,
  type IllustrationSuggestion,
} from '@/lib/api'
import {
  type ArticleBlockV2,
  type ArticleSectionV2,
  type ArticleV2,
  blockPlainText,
  orderedBlocks,
  orderedSections,
  sectionKeyTerms,
} from '@/lib/article-v2'

import './magazine-article.css'

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
  provenance?: {
    sourceUrl?: string | null
    captureSource?: CaptureSource | null
  }
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
  provenance,
}: MagazineArticleProps) {
  const allSections = useMemo(() => orderedSections(article), [article])

  // The adapter surfaces the source abstract as the first section (its
  // section_id ends with `-abstract`). We lift it out as a faithful, source-
  // grounded lede and exclude it from the two-column stream, the TOC, and the
  // section count — `sections` is everything that flows in the stream.
  const { ledeSection, sections } = useMemo(() => {
    const first = allSections[0]
    if (first?.section_id?.endsWith('-abstract')) {
      return { ledeSection: first, sections: allSections.slice(1) }
    }
    return { ledeSection: null, sections: allSections }
  }, [allSections])

  // Only rendered illustrations become plates (the "use existing" decision —
  // no on-demand generation here). Group by the section their anchor blocks
  // live in; an unanchored cover floats to the top of the stream.
  const { coverPlates, platesBySection } = useMemo(() => {
    const ready = illustrations.filter(
      (s) => s.approval === 'approved' && s.image,
    )
    const blockToSection = new Map<string, string>()
    for (const sec of sections) {
      for (const b of sec.blocks) blockToSection.set(b.block_id, sec.section_id)
    }
    const bySection = new Map<string, IllustrationSuggestion[]>()
    const cover: IllustrationSuggestion[] = []
    for (const s of ready) {
      const anchorSection = s.sourceBlockIds
        .map((id) => blockToSection.get(id))
        .find(Boolean)
      if (anchorSection) {
        const arr = bySection.get(anchorSection) ?? []
        arr.push(s)
        bySection.set(anchorSection, arr)
      } else {
        cover.push(s)
      }
    }
    return { coverPlates: cover, platesBySection: bySection }
  }, [illustrations, sections])

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
  const date = new Date(article.generated_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const captureLabel = provenance?.captureSource
    ? CAPTURE_LABEL[provenance.captureSource]
    : null

  // The drop-cap lead is used once, on the first paragraph of the article.
  let leadUsed = false
  const takeLead = () => {
    if (leadUsed) return false
    leadUsed = true
    return true
  }

  return (
    <article className='kb-mag'>
      <ReadingProgress />

      <header className='kb-mag-head'>
        <div className='kb-mag-kicker'>
          {enrichment?.classification ?? 'Kibadist Compendium · Entry'}
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
          <span className='sep'>/</span>
          <span>{date}</span>
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

      {ledeSection && (
        <div className='kb-mag-lede'>
          {orderedBlocks(ledeSection)
            .filter(
              (b): b is Extract<ArticleBlockV2, { type: 'paragraph' }> =>
                b.type === 'paragraph',
            )
            .map((b) => (
              <p key={b.block_id} id={b.block_id}>
                <InlineRuns runs={b.content.runs} />
              </p>
            ))}
        </div>
      )}

      <div className='kb-mag-layout'>
        <div className='kb-mag-stream'>
          {coverPlates.map((s) => (
            <IllustrationPlate
              key={s.id}
              articleId={articleId}
              suggestion={s}
              span
            />
          ))}

          {sections.map((section, i) => (
            <Fragment key={section.section_id}>
              <div className='kb-mag-sec' id={section.section_id}>
                <span className='num'>§ {pad(i + 1)}</span>
                <h2>{section.heading}</h2>
              </div>
              {orderedBlocks(section).map((block) => (
                <MagazineBlock
                  key={block.block_id}
                  block={block}
                  isLead={block.type === 'paragraph' && takeLead()}
                />
              ))}
              {(platesBySection.get(section.section_id) ?? []).map((s) => (
                <IllustrationPlate
                  key={s.id}
                  articleId={articleId}
                  suggestion={s}
                  span
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
              <InfoRow label='Compiled' value={date} />
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
    </article>
  )
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

/** One Article-JSON-v2 block in the magazine vocabulary. */
function MagazineBlock({
  block,
  isLead,
}: {
  block: ArticleBlockV2
  isLead: boolean
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={isLead ? 'kb-mag-lead' : undefined} id={block.block_id}>
          <InlineRuns runs={block.content.runs} />
        </p>
      )
    case 'heading':
      // Section titles come from `section.heading` (§ bars); heading blocks are
      // in-column sub-heads.
      return (
        <h3 id={block.block_id}>
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
        <ol id={block.block_id}>{items}</ol>
      ) : (
        <ul id={block.block_id}>{items}</ul>
      )
    }
    case 'quote':
      // A quote becomes the pull-quote — the magazine's spanning display device.
      return (
        <blockquote className='kb-mag-pull' id={block.block_id}>
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
        <div className='kb-mag-marginal' id={block.block_id}>
          <span className='mh'>
            {block.content.title ?? block.content.variant ?? 'Note'}
          </span>
          <InlineRuns runs={block.content.runs} />
        </div>
      )
    case 'table': {
      const rows = block.content.rows
      if (rows.length === 0) return null
      const [head, ...body] = block.content.header ? rows : [null, ...rows]
      return (
        <table id={block.block_id}>
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
        <pre id={block.block_id}>
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

/** A rendered illustration as a captioned plate (authed blob fetch). */
function IllustrationPlate({
  articleId,
  suggestion,
  span,
}: {
  articleId: string
  suggestion: IllustrationSuggestion
  span?: boolean
}) {
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

  return (
    <figure className={`kb-mag-plate${span ? ' is-span' : ''}`}>
      <div className='frame'>
        <span className='figtag'>
          {ILLUS_LABEL[suggestion.illustrationType]}
        </span>
        {failed ? (
          <div className='ph'>Illustration unavailable</div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={suggestion.caption} />
        ) : (
          <div className='ph'>Rendering…</div>
        )}
      </div>
      {suggestion.caption && (
        <figcaption>
          <span className='aichip'>✦ AI</span>
          {suggestion.caption}
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
