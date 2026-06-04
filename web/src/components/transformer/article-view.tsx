'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import {
  ApiError,
  type ArticleBlock,
  type ArticleCallout,
  type ArticleCalloutBlock,
  type ArticleCodeBlock,
  type ArticleFigureAnchorBlock,
  type ArticleJsonV2,
  type ArticleListBlock,
  type ArticleParagraph,
  type ArticleParagraphBlock,
  type ArticleQuoteBlock,
  type ArticleReadingAids,
  type ArticleSectionV2,
  type ArticleShape,
  type ArticleTableBlock,
  api,
  type IllustrationPlan,
  type IllustrationSuggestion,
  type SectionRole,
  type TocEntry,
} from '@/lib/api'
import { fidelityRiskChip } from '@/lib/transformer-format'
import { placeIllustrations } from './illustration-placement'
import {
  AiFigureCaption,
  ILLUSTRATION_TYPE_LABEL,
  IllustrationThumbnail,
  useIllustrationActions,
} from './illustration-shared'
import type { InspectorSelection } from './source-inspector-panel'

/**
 * The rich article body — the product's centerpiece (DET-256), rebuilt to read
 * like a science-magazine page (Nautilus / Quanta). A thin masthead rule, an
 * oversized hero (display title, italic standfirst, byline/meta, hero
 * illustration slot, drop-cap lede), inline block-anchored illustration slots
 * (DET-259/261), one source-grounded pull-quote, and per-section ornaments —
 * all on the existing `.kbapp` editorial tokens, light-only.
 *
 * There is NO textarea and NO raw JSON anywhere — this is reading. Every
 * paragraph is clickable → opens the source inspector (DET-257); a paragraph
 * with no source block ids renders an explicit error chip instead of being
 * openable, so a broken traceability link is loud, not hidden.
 *
 * INVARIANT (DET-258): inline AI images stay unmistakably AI-assisted — an
 * accent-blue (indigo) hairline frame distinct from the ink/rule used for
 * source text, a "✦ AI illustration" chip, and an "AI · grounded in …" caption.
 * Only source text is citable in the source inspector; art never is.
 */
/**
 * Editorial label + one-line gloss for each genre shape (DET-273). The shape is
 * DETECTED from the source's block classifications and only reorganizes form —
 * it never adds substance — so the label reads as a reading aid, not a claim.
 */
const SHAPE_LABEL: Record<ArticleShape, string> = {
  explainer: 'Explainer — concept first',
  argument: 'Argument — claim, evidence, caveats',
  procedure: 'Procedure — ordered steps preserved',
  reference: 'Reference — term-led entries',
  report: 'Report — source order',
  narrative: 'Narrative — chronological',
  hybrid: 'Hybrid — mixed structure',
}

/** Small-caps label for each source-grounded section role (DET-273). */
const SECTION_ROLE_LABEL: Record<SectionRole, string> = {
  definition: 'Definition',
  claim: 'Claim',
  evidence: 'Evidence',
  example: 'Example',
  step: 'Steps',
  caveat: 'Caveat',
  background: 'Background',
  referenceEntry: 'Reference entry',
  chronology: 'Chronology',
}

export function ArticleView({
  article,
  articleId,
  illustrationPlan,
  sourceBlockCount,
  masthead,
  onInspect,
}: {
  article: ArticleJsonV2
  articleId: string
  illustrationPlan: IllustrationPlan | null
  /** Count of distinct source blocks, for the byline. Omitted if not derivable. */
  sourceBlockCount: number | null
  /** The demoted status/fidelity chips, rendered into the masthead rule. */
  masthead: ReactNode
  // Open the source inspector for a transformed fragment.
  onInspect: (selection: InspectorSelection) => void
}) {
  const queryClient = useQueryClient()

  // The approve/reject mutation shared by every inline slot (DET-261). Render +
  // remove are per-suggestion (useIllustrationActions); approval is one shared
  // mutation, invalidating the same article query the panel uses.
  const approve = useMutation({
    mutationFn: (input: {
      suggestionId: string
      approval: 'approved' | 'rejected'
    }) =>
      api.setIllustrationApproval(
        articleId,
        input.suggestionId,
        input.approval,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

  const placement = placeIllustrations(article, illustrationPlan)

  // Inline callout placement (DET-272). The end-matter (keyTerms / examples /
  // caveats) is re-placed beside the section it overlaps most; the server
  // computes this deterministically and attaches it to `calloutPlacements`. The
  // top-level arrays remain the single source of truth; here we only RENDER the
  // placement. `bySection` anchors margin notes / inline cards beside a section;
  // `unplaced` items render in a general group at the end (nowhere else to live).
  const callouts = article.calloutPlacements ?? { bySection: {}, unplaced: [] }
  const hasIndex =
    Object.values(callouts.bySection).some((cs) => cs.length > 0) ||
    callouts.unplaced.length > 0

  // Reading aids (DET-274): deterministic TOC + reading time + source-grounded
  // highlights, computed server-side and attached to `readingAids`. Old articles
  // generated before this wave have no aids — every consumer is guarded so the
  // renderer never crashes and simply omits the affordance when absent.
  const readingAids = article.readingAids
  const toc = readingAids?.toc ?? []
  const highlights = readingAids?.highlights ?? []

  return (
    <article className='tf-article'>
      {/* ---- Masthead rule: kicker left, demoted chips right ---- */}
      <div className='tf-masthead'>
        <span className='tf-masthead-kicker'>Source-preserving transform</span>
        <div className='tf-masthead-chips'>{masthead}</div>
      </div>

      {/* ---- Table of contents (DET-274) ----
          A sticky rail in the left gutter on wide screens, a collapsible
          <details> block above the article on narrow screens. Anchors link to a
          section's stable DOM id (#section-id); subsection children are indented
          one level. Omitted entirely when there are no headings. */}
      {toc.length > 0 && <TableOfContents toc={toc} />}

      {/* ---- Hero ---- */}
      <header className='tf-hero'>
        <h1 className='tf-article-title'>{article.title.text}</h1>
        {article.subtitle && (
          <p className='tf-hero-standfirst'>{article.subtitle.text}</p>
        )}
        <div className='tf-hero-byline'>
          <span>Source-preserving transform</span>
          {sourceBlockCount != null && (
            <>
              <span className='tf-byline-dot' aria-hidden='true'>
                ·
              </span>
              <span>
                {sourceBlockCount} source block
                {sourceBlockCount === 1 ? '' : 's'}
              </span>
            </>
          )}
          {readingAids && (
            <>
              <span className='tf-byline-dot' aria-hidden='true'>
                ·
              </span>
              <span>{readingAids.readingTime.minutes} min read</span>
            </>
          )}
          {article.shape && (
            <>
              <span className='tf-byline-dot' aria-hidden='true'>
                ·
              </span>
              <span className='tf-article-shape'>
                {SHAPE_LABEL[article.shape]}
              </span>
            </>
          )}
        </div>
        <div className='tf-hero-rule' aria-hidden='true' />

        {placement.hero && (
          <IllustrationSlot
            articleId={articleId}
            suggestion={placement.hero}
            approve={approve}
            onInspect={onInspect}
            variant='hero'
          />
        )}
      </header>

      {article.abstract.length > 0 && (
        <section className='tf-article-abstract'>
          {article.abstract.map((p, i) => (
            <Paragraph
              key={p.id}
              paragraph={p}
              kind='Abstract'
              lede={i === 0}
              onInspect={onInspect}
            />
          ))}
        </section>
      )}

      {/* ---- Source Highlights (DET-274) ----
          An editorial box near the hero. Each highlight is a preserved,
          source-grounded fragment (verbatim claim or lightly-cleaned leading
          sentence) — clicking opens the source inspector with its sourceBlockIds.
          Omitted entirely when no safe highlight survived selection. */}
      {highlights.length > 0 && (
        <SourceHighlights highlights={highlights} onInspect={onInspect} />
      )}

      {article.sections.map((section, i) => {
        const slot = placement.bySection.get(section.id)
        const placedCallouts = callouts.bySection[section.id] ?? []
        return (
          // The section wrapper is relatively positioned + carries a stable DOM
          // id: the margin-note rail anchors into its right gutter on wide
          // screens, and the compact end index links back here via #section-id.
          <div key={section.id} id={section.id} className='tf-section-wrap'>
            {i > 0 && <SectionOrnament />}
            <section className='tf-article-section'>
              <SectionHeading
                section={section}
                level={2}
                onInspect={onInspect}
              />
              {slot && (
                <IllustrationSlot
                  articleId={articleId}
                  suggestion={slot}
                  approve={approve}
                  onInspect={onInspect}
                  variant='column'
                />
              )}
              {section.blocks.map((b) => (
                <Block key={b.id} block={b} onInspect={onInspect} />
              ))}
              {section.subsections?.map((sub) => (
                <section key={sub.id} className='tf-article-subsection'>
                  <SectionHeading
                    section={sub}
                    level={3}
                    onInspect={onInspect}
                  />
                  {sub.blocks.map((b) => (
                    <Block key={b.id} block={b} onInspect={onInspect} />
                  ))}
                </section>
              ))}
            </section>
            {placedCallouts.length > 0 && (
              <aside className='tf-callout-rail' aria-label='Section notes'>
                {placedCallouts.map((c) => (
                  <CalloutNote key={c.id} callout={c} onInspect={onInspect} />
                ))}
              </aside>
            )}
          </div>
        )
      })}

      {/* The terminal full "Key terms / Source examples / Important caveats"
          sections are gone (DET-272). Their content now appears inline as placed
          callouts beside the section it belongs to. What remains here is a
          COMPACT INDEX — short labels linking back to where each callout sits —
          plus a general group rendering any UNPLACED item in full (it has
          nowhere inline to live). */}
      {hasIndex && (
        <CalloutIndex
          bySection={callouts.bySection}
          sections={article.sections}
          unplaced={callouts.unplaced}
          onInspect={onInspect}
        />
      )}
    </article>
  )
}

/**
 * The table of contents (DET-274). Rendered as a `<details>` element so it is a
 * collapsible block on narrow screens out of the box; CSS pins it as a sticky
 * rail in the left gutter on wide screens. Anchors link to each section's stable
 * DOM id (#section-id); one level of subsection children is indented. Open by
 * default so the rail reads as a standing nav on wide screens.
 */
function TableOfContents({ toc }: { toc: TocEntry[] }) {
  return (
    <details className='tf-toc' open>
      <summary className='tf-toc-summary'>Contents</summary>
      <nav className='tf-toc-nav' aria-label='Table of contents'>
        <ol className='tf-toc-list'>
          {toc.map((entry) => (
            <li key={entry.sectionId} className='tf-toc-item'>
              <a className='tf-toc-link' href={`#${entry.sectionId}`}>
                {entry.heading}
              </a>
              {entry.children && entry.children.length > 0 && (
                <ol className='tf-toc-list tf-toc-list--nested'>
                  {entry.children.map((child) => (
                    <li key={child.sectionId} className='tf-toc-item'>
                      <a
                        className='tf-toc-link tf-toc-link--child'
                        href={`#${child.sectionId}`}
                      >
                        {child.heading}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </details>
  )
}

/**
 * The Source Highlights box (DET-274) near the hero. Each highlight is a
 * source-grounded preserved fragment; clicking opens the source inspector with
 * the highlight's own sourceBlockIds. Highlights always carry non-empty ids (the
 * server omits unsafe ones), so every row is clickable.
 */
function SourceHighlights({
  highlights,
  onInspect,
}: {
  highlights: NonNullable<ArticleReadingAids['highlights']>
  onInspect: (selection: InspectorSelection) => void
}) {
  return (
    <section className='tf-highlights' aria-label='Source Highlights'>
      <h2 className='tf-highlights-label'>Source Highlights</h2>
      <ul className='tf-highlights-list'>
        {highlights.map((h, i) => (
          <li key={`${i}-${h.sourceBlockIds.join('-')}`}>
            <button
              type='button'
              className='tf-highlight'
              onClick={() =>
                onInspect({
                  kind: 'Source highlight',
                  transformedText: h.text,
                  sourceBlockIds: h.sourceBlockIds,
                })
              }
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Small-caps label + accent for each callout kind. */
const CALLOUT_KIND_LABEL: Record<ArticleCallout['kind'], string> = {
  keyTerm: 'Key term',
  example: 'Example',
  caveat: 'Caveat',
}

/**
 * A single placed callout — a margin note on wide screens (anchored into the
 * section's right gutter via the rail) and an inline card on narrow screens. It
 * is clickable → opens the source inspector with the item's own sourceBlockIds
 * and a kind-labelled selection. An untraceable item (no sourceBlockIds) shows a
 * loud "missing source" chip and is not clickable.
 */
function CalloutNote({
  callout,
  onInspect,
}: {
  callout: ArticleCallout
  onInspect: (selection: InspectorSelection) => void
}) {
  const label = CALLOUT_KIND_LABEL[callout.kind]
  const missing = callout.sourceBlockIds.length === 0
  const body = (
    <>
      <p
        className={`tf-callout-note-kind tf-callout-note-kind--${callout.kind}`}
      >
        {label}
      </p>
      <p className='tf-callout-note-text'>{callout.text}</p>
    </>
  )

  if (missing) {
    return (
      <div className='tf-callout-note tf-callout-note--missing'>
        {body}
        <span className='chip chip-contested'>missing source</span>
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-callout-note tf-callout-note--clickable'
      onClick={() =>
        onInspect({
          kind: label,
          transformedText: callout.text,
          sourceBlockIds: callout.sourceBlockIds,
        })
      }
    >
      {body}
    </button>
  )
}

/**
 * The compact end-of-article index (DET-272) that replaces the old full
 * end-matter sections. For every PLACED callout it shows a one-line label + an
 * anchor link (#section-id) back to where the callout is rendered. UNPLACED
 * items have no section to point at, so they render in FULL under a general
 * "Notes" group (clickable into the inspector) — they would otherwise vanish.
 */
function CalloutIndex({
  bySection,
  sections,
  unplaced,
  onInspect,
}: {
  bySection: Record<string, ArticleCallout[]>
  sections: ArticleSectionV2[]
  unplaced: ArticleCallout[]
  onInspect: (selection: InspectorSelection) => void
}) {
  const headingById = new Map(sections.map((s) => [s.id, s.heading]))
  // Walk sections in reading order so the index mirrors the article.
  const placedRows = sections
    .flatMap((s) =>
      (bySection[s.id] ?? []).map((c) => ({ sectionId: s.id, c })),
    )
    .filter((row) => row.c.text.length > 0)

  return (
    <section className='tf-article-aux tf-callout-end'>
      {placedRows.length > 0 && (
        <>
          <h3 className='tf-aux-h'>Index</h3>
          <ul className='tf-callout-index'>
            {placedRows.map(({ sectionId, c }) => (
              <li key={c.id} className='tf-callout-index-row'>
                <span
                  className={`tf-callout-index-kind tf-callout-index-kind--${c.kind}`}
                >
                  {CALLOUT_KIND_LABEL[c.kind]}
                </span>
                <a className='tf-callout-index-link' href={`#${sectionId}`}>
                  {c.kind === 'keyTerm'
                    ? (c.term ?? c.text)
                    : shortLabel(c.text)}
                </a>
                <span className='tf-callout-index-where'>
                  {headingById.get(sectionId) ?? sectionId}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {unplaced.length > 0 && (
        <div className='tf-callout-unplaced'>
          <h3 className='tf-aux-h'>Notes</h3>
          <ul className='tf-aux-list'>
            {unplaced.map((c) => (
              <li key={c.id}>
                <CalloutNote callout={c} onInspect={onInspect} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** First sentence / clause of a callout body, for a compact index label. */
function shortLabel(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 64) return trimmed
  return `${trimmed.slice(0, 61).trimEnd()}…`
}

function SectionOrnament() {
  return (
    <div className='tf-ornament' aria-hidden='true'>
      <span className='tf-ornament-mark'>✶</span>
    </div>
  )
}

/**
 * A section (or subsection) heading. When the heading carries
 * `headingSourceBlockIds` (its provenance — the source heading block it was taken
 * from), the text becomes a clickable button that opens the source inspector
 * (DET-276), exactly like a body block. A heading with no provenance (e.g. an
 * inferred heading) renders as plain, non-clickable text.
 */
function SectionHeading({
  section,
  level,
  onInspect,
}: {
  section: ArticleSectionV2
  level: 2 | 3
  onInspect: (selection: InspectorSelection) => void
}) {
  const className = level === 2 ? 'tf-article-heading' : 'tf-article-subheading'
  const sourceBlockIds = section.headingSourceBlockIds ?? []
  const Tag = level === 2 ? 'h2' : 'h3'
  // A subtle small-caps role label (DET-273), rendered only when the section
  // carries a source-grounded sectionRole. It is a reading aid beside the
  // heading — never a separate clickable surface.
  const roleLabel = section.sectionRole
    ? SECTION_ROLE_LABEL[section.sectionRole]
    : null
  // The role label sits in a wrapper BESIDE the heading element (not inside it),
  // so the heading keeps its own accessible name and the label stays a quiet aid.
  const role = roleLabel ? (
    <span className='tf-section-role'>{roleLabel}</span>
  ) : null
  if (sourceBlockIds.length === 0) {
    return (
      <div className='tf-heading-row'>
        <Tag className={className}>{section.heading}</Tag>
        {role}
      </div>
    )
  }
  return (
    <div className='tf-heading-row'>
      <Tag className={className}>
        <button
          type='button'
          className='tf-heading-btn'
          onClick={() =>
            onInspect({
              kind: 'Section heading',
              transformedText: section.heading,
              sourceBlockIds,
            })
          }
        >
          {section.heading}
        </button>
      </Tag>
      {role}
    </div>
  )
}

/**
 * A large italic display pull-quote for first-class generator-emitted `pullQuote`
 * blocks (DET-271). The ad-hoc caveat pull-quote was removed in W6 (DET-272):
 * caveats now render as placed inline callouts, so the only pull-quotes left are
 * real generator blocks. The `kind` keeps the inspector label honest.
 */
function PullQuote({
  text,
  sourceBlockIds,
  kind,
  onInspect,
}: {
  text: string
  sourceBlockIds: string[]
  kind: string
  onInspect: (selection: InspectorSelection) => void
}) {
  return (
    <figure className='tf-pullquote'>
      <blockquote className='tf-pullquote-text'>“{text}”</blockquote>
      <figcaption className='tf-pullquote-cite'>
        <button
          type='button'
          className='tf-pullquote-ref'
          onClick={() =>
            onInspect({
              kind,
              transformedText: text,
              sourceBlockIds,
            })
          }
        >
          source ¶ ({sourceBlockIds.length})
        </button>
      </figcaption>
    </figure>
  )
}

/**
 * An inline, block-anchored illustration slot (DET-259/261 + the magazine
 * redesign). Driven entirely by an existing suggestion (the backend only
 * renders approved suggestions), so the slot's state mirrors the suggestion's:
 *
 *  - not approved   → the proposal (purpose/description/caption + risk chip)
 *                     with Approve / Reject; approving reveals Generate.
 *  - approved, no image → a dashed accent-blue figure frame with "✦ Generate
 *                     illustration" (high-risk confirm flow) + "✕ Remove slot".
 *  - approved + image   → the rendered figure (IllustrationThumbnail) as a
 *                     proper <figure> with the AI chip + caption, plus
 *                     Regenerate / Remove.
 *
 * Render/remove reuse the shared DET-261 mutations via useIllustrationActions;
 * approval reuses the article view's shared approve mutation. The hero variant
 * gets a wider/full-width treatment; the column variant sits in the measure.
 */
function IllustrationSlot({
  articleId,
  suggestion: s,
  approve,
  onInspect,
  variant,
}: {
  articleId: string
  suggestion: IllustrationSuggestion
  approve: ReturnType<
    typeof useMutation<
      IllustrationPlan,
      Error,
      { suggestionId: string; approval: 'approved' | 'rejected' }
    >
  >
  onInspect: (selection: InspectorSelection) => void
  variant: 'hero' | 'column'
}) {
  const {
    render,
    remove,
    renderError,
    removeError,
    confirmHighRisk,
    setConfirmHighRisk,
    busy,
  } = useIllustrationActions(articleId, s.id)

  const isHighRisk = s.fidelityRisk === 'high'
  const isApproved = s.approval === 'approved'

  // The AI-assisted caption (DET-258): always prefaced "AI · grounded in …" so
  // a rendered figure can never read as source matter. Shared with the
  // management grid so the labeling can never drift between the two surfaces.
  const aiCaption = (
    <AiFigureCaption sourceBlockIds={s.sourceBlockIds} caption={s.caption} />
  )

  return (
    <div className={`tf-slot tf-slot--${variant}`}>
      {/* --- Approved + rendered: the real figure --- */}
      {isApproved && s.image ? (
        <figure className='tf-fig'>
          <IllustrationThumbnail
            articleId={articleId}
            suggestionId={s.id}
            meta={s.image}
            framed
            alt={`AI illustration · ${s.purpose}`}
          />
          {aiCaption}
          {renderError && (
            <p className='notice notice-error tf-illus-notice'>{renderError}</p>
          )}
          {removeError && (
            <p className='notice notice-error tf-illus-notice'>{removeError}</p>
          )}
          <div className='tf-fig-actions'>
            <button
              type='button'
              className='btn-ghost-xs'
              disabled={busy}
              onClick={() => render.mutate(isHighRisk)}
            >
              {render.isPending ? (
                <span className='tf-illus-spinning'>
                  <span className='tf-spinner' aria-hidden='true' />
                  Generating…
                </span>
              ) : (
                '⟳ Regenerate'
              )}
            </button>
            <button
              type='button'
              className='btn-ghost-xs danger'
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Removing…' : '✕ Remove'}
            </button>
            <button
              type='button'
              className='tf-ref-btn tf-fig-ref'
              onClick={() =>
                onInspect({
                  kind: 'Illustration',
                  transformedText: `${s.purpose} — ${s.visualDescription}`,
                  sourceBlockIds: s.sourceBlockIds,
                })
              }
            >
              source refs ({s.sourceBlockIds.length})
            </button>
          </div>
        </figure>
      ) : isApproved ? (
        /* --- Approved, no image yet: dashed AI frame + Generate / Remove --- */
        <div className='tf-frame'>
          <div className='tf-frame-aichip'>✦ AI illustration</div>
          <p className='tf-frame-grounded'>
            Grounded in {s.sourceBlockIds.length} source block
            {s.sourceBlockIds.length === 1 ? '' : 's'} of this section
          </p>
          {renderError && (
            <p className='notice notice-error tf-illus-notice'>{renderError}</p>
          )}
          {isHighRisk && confirmHighRisk ? (
            <div className='tf-frame-confirm'>
              <p className='tf-illus-confirm-text'>
                This is a high-risk diagram — render anyway?
              </p>
              <div className='tf-frame-actions'>
                <button
                  type='button'
                  className='btn-ghost-xs danger'
                  disabled={render.isPending}
                  onClick={() => render.mutate(true)}
                >
                  {render.isPending ? (
                    <span className='tf-illus-spinning'>
                      <span className='tf-spinner' aria-hidden='true' />
                      Generating…
                    </span>
                  ) : (
                    'Render anyway'
                  )}
                </button>
                <button
                  type='button'
                  className='btn-ghost-xs'
                  disabled={render.isPending}
                  onClick={() => setConfirmHighRisk(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className='tf-frame-actions'>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={render.isPending}
                onClick={() =>
                  isHighRisk ? setConfirmHighRisk(true) : render.mutate(false)
                }
              >
                {render.isPending ? (
                  <span className='tf-illus-spinning'>
                    <span className='tf-spinner' aria-hidden='true' />
                    Generating…
                  </span>
                ) : (
                  '✦ Generate illustration'
                )}
              </button>
              <button
                type='button'
                className='btn-ghost-xs danger'
                disabled={busy || approve.isPending}
                onClick={() =>
                  approve.mutate({ suggestionId: s.id, approval: 'rejected' })
                }
              >
                ✕ Remove slot
              </button>
            </div>
          )}
        </div>
      ) : (
        /* --- Not approved: a QUIET collapsible strip. Default state is a single
           muted line ("✦ Illustration suggested — review") that keeps the AI
           provenance visible (DET-258) without a heavy card in every section;
           it expands to the full proposal + Approve / Reject on click. --- */
        <details className='tf-proposal-strip'>
          <summary className='tf-proposal-summary'>
            <span className='tf-proposal-mark' aria-hidden='true'>
              ✦
            </span>
            <span className='tf-proposal-label'>Illustration suggested</span>
            <span className={`chip ${fidelityRiskChip(s.fidelityRisk)}`}>
              {s.fidelityRisk} risk
            </span>
            <span className='tf-proposal-review'>review</span>
          </summary>
          <div className='tf-proposal-body'>
            <div className='tf-proposal-top'>
              <span className='tf-fig-aichip'>✦ AI illustration</span>
              <span className='chip chip-info'>
                {ILLUSTRATION_TYPE_LABEL[s.illustrationType] ??
                  s.illustrationType}
              </span>
            </div>
            <p className='tf-proposal-purpose'>{s.purpose}</p>
            <p className='tf-proposal-desc'>{s.visualDescription}</p>
            {s.caption && <p className='tf-proposal-caption'>“{s.caption}”</p>}
            {isHighRisk && s.reason && (
              <p className='tf-illus-reason'>{s.reason}</p>
            )}
            <div className='tf-proposal-foot'>
              <button
                type='button'
                className='tf-ref-btn'
                onClick={() =>
                  onInspect({
                    kind: 'Illustration',
                    transformedText: `${s.purpose} — ${s.visualDescription}`,
                    sourceBlockIds: s.sourceBlockIds,
                  })
                }
              >
                source refs ({s.sourceBlockIds.length})
              </button>
              <div className='tf-proposal-actions'>
                <button
                  type='button'
                  className='btn-ghost-xs'
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate({ suggestionId: s.id, approval: 'approved' })
                  }
                >
                  Approve
                </button>
                <button
                  type='button'
                  className='btn-ghost-xs'
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate({ suggestionId: s.id, approval: 'rejected' })
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

/**
 * Render one v2 section block (DET-271). Each typed block gets first-class
 * magazine styling consistent with the `.kbapp` editorial tokens, and EVERY type
 * is clickable → opens the source inspector with its own sourceBlockIds (same
 * pattern as a paragraph). A block with no source block ids renders an explicit
 * "missing source" error chip and is NOT clickable, so a broken traceability
 * link is loud for every type, not just paragraphs.
 *
 * Per type: paragraph (prose, drop-cap-capable), list (ordered → numbered,
 * unordered → bulleted), quote (blockquote + em-dash attribution), pullQuote
 * (large italic display excerpt), table (editorial grid with caption + header
 * row), code (monospace block with an optional language chip), callout (bordered
 * aside card with optional title), figureAnchor (metadata only — renders nothing
 * visible; illustration placement owns inline figures, DET-259/272).
 */
function Block({
  block,
  onInspect,
}: {
  block: ArticleBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <Paragraph paragraph={block} kind='Paragraph' onInspect={onInspect} />
      )
    case 'list':
      return <ListBlock block={block} onInspect={onInspect} />
    case 'quote':
      return <QuoteBlock block={block} onInspect={onInspect} />
    case 'pullQuote':
      return (
        <PullQuote
          text={block.text}
          sourceBlockIds={block.sourceBlockIds}
          kind='Pull-quote'
          onInspect={onInspect}
        />
      )
    case 'table':
      return <TableBlock block={block} onInspect={onInspect} />
    case 'code':
      return <CodeBlock block={block} onInspect={onInspect} />
    case 'callout':
      return <CalloutBlock block={block} onInspect={onInspect} />
    case 'figureAnchor':
      // Metadata only: the illustration slot system (DET-259/272) owns inline
      // figures, so an anchor renders nothing visible. A subtle, inspectable
      // marker keeps its provenance reachable when it carries a caption.
      return <FigureAnchorBlock block={block} onInspect={onInspect} />
    default:
      // Exhaustiveness guard: a new ArticleBlock member added without a case
      // here is a compile error (the union is narrowed to `never`).
      return assertNever(block)
  }
}

/** Shared "missing source reference" chip for an untraceable typed block. */
function MissingSourceChip() {
  return (
    <span className='chip chip-contested tf-missing-chip'>
      missing source reference
    </span>
  )
}

/** An ordered/unordered list — numbered or bulleted, clickable into inspector. */
function ListBlock({
  block,
  onInspect,
}: {
  block: ArticleListBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = block.sourceBlockIds.length === 0
  const items = block.items.map((item, i) => (
    <li key={`${i}-${item.slice(0, 24)}`} className='tf-list-item'>
      {item}
    </li>
  ))
  const list = block.ordered ? (
    <ol className='tf-list tf-list--ordered'>{items}</ol>
  ) : (
    <ul className='tf-list tf-list--unordered'>{items}</ul>
  )

  if (missing) {
    return (
      <div className='tf-block tf-block--missing'>
        {list}
        <MissingSourceChip />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-block tf-block--clickable'
      onClick={() =>
        onInspect({
          kind: 'List',
          transformedText: block.items.join('\n'),
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      {list}
    </button>
  )
}

/** A block quotation with an em-dash attribution line when present. */
function QuoteBlock({
  block,
  onInspect,
}: {
  block: ArticleQuoteBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = block.sourceBlockIds.length === 0
  const body = (
    <figure className='tf-quote'>
      <blockquote className='tf-quote-text'>“{block.text}”</blockquote>
      {block.attribution && (
        <figcaption className='tf-quote-attr'>— {block.attribution}</figcaption>
      )}
    </figure>
  )

  if (missing) {
    return (
      <div className='tf-block tf-block--missing'>
        {body}
        <MissingSourceChip />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-block tf-block--clickable'
      onClick={() =>
        onInspect({
          kind: 'Quote',
          transformedText: block.attribution
            ? `“${block.text}” — ${block.attribution}`
            : `“${block.text}”`,
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      {body}
    </button>
  )
}

/** A clean editorial table — caption, styled header row, body rows. */
function TableBlock({
  block,
  onInspect,
}: {
  block: ArticleTableBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = block.sourceBlockIds.length === 0
  const flat = [
    block.caption,
    ...(block.header ? [block.header.join(' | ')] : []),
    ...block.rows.map((r) => r.join(' | ')),
  ]
    .filter(Boolean)
    .join('\n')

  const table = (
    <figure className='tf-table-wrap'>
      <table className='tf-table'>
        {block.header && (
          <thead>
            <tr>
              {block.header.map((h, i) => (
                <th key={`${i}-${h}`}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={`r-${ri}-${row[0] ?? ''}`}>
              {row.map((cell, ci) => (
                <td key={`c-${ri}-${ci}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {block.caption && (
        <figcaption className='tf-table-caption'>{block.caption}</figcaption>
      )}
    </figure>
  )

  if (missing) {
    return (
      <div className='tf-block tf-block--missing'>
        {table}
        <MissingSourceChip />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-block tf-block--clickable tf-block--table'
      onClick={() =>
        onInspect({
          kind: 'Table',
          transformedText: flat,
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      {table}
    </button>
  )
}

/** A monospace code block with a light editorial background + language chip. */
function CodeBlock({
  block,
  onInspect,
}: {
  block: ArticleCodeBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = block.sourceBlockIds.length === 0
  const body = (
    <figure className='tf-code'>
      {block.language && (
        <figcaption className='tf-code-lang'>{block.language}</figcaption>
      )}
      <pre className='tf-code-pre'>
        <code>{block.text}</code>
      </pre>
    </figure>
  )

  if (missing) {
    return (
      <div className='tf-block tf-block--missing'>
        {body}
        <MissingSourceChip />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-block tf-block--clickable tf-block--code'
      onClick={() =>
        onInspect({
          kind: 'Code',
          transformedText: block.text,
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      {body}
    </button>
  )
}

/** A bordered aside card (note box) with an optional title. */
function CalloutBlock({
  block,
  onInspect,
}: {
  block: ArticleCalloutBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = block.sourceBlockIds.length === 0
  const body = (
    <aside className='tf-callout'>
      {block.title && <p className='tf-callout-title'>{block.title}</p>}
      <p className='tf-callout-text'>{block.text}</p>
    </aside>
  )

  if (missing) {
    return (
      <div className='tf-block tf-block--missing'>
        {body}
        <MissingSourceChip />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='tf-block tf-block--clickable tf-block--callout'
      onClick={() =>
        onInspect({
          kind: 'Callout',
          transformedText: block.title
            ? `${block.title}: ${block.text}`
            : block.text,
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      {body}
    </button>
  )
}

/**
 * A figure anchor is metadata: the illustration slot system places inline
 * figures, so the anchor itself renders nothing visible. When it carries a
 * caption we expose a single subtle inspector marker so its provenance stays
 * reachable; an untraceable anchor is silently dropped (it is furniture, never
 * source content shown to the reader).
 */
function FigureAnchorBlock({
  block,
  onInspect,
}: {
  block: ArticleFigureAnchorBlock
  onInspect: (selection: InspectorSelection) => void
}) {
  if (!block.caption || block.sourceBlockIds.length === 0) return null
  return (
    <button
      type='button'
      className='tf-figure-anchor'
      onClick={() =>
        onInspect({
          kind: 'Figure anchor',
          transformedText: block.caption ?? '',
          sourceBlockIds: block.sourceBlockIds,
          transformationType: block.transformationType,
          fidelityRisk: block.fidelityRisk,
        })
      }
    >
      ◇ {block.caption}
    </button>
  )
}

/** Compile-time exhaustiveness assertion for discriminated-union switches. */
function assertNever(value: never): never {
  throw new Error(`Unhandled block type: ${JSON.stringify(value)}`)
}

function Paragraph({
  paragraph,
  kind,
  lede = false,
  onInspect,
}: {
  paragraph: ArticleParagraph | ArticleParagraphBlock
  kind: string
  lede?: boolean
  onInspect: (selection: InspectorSelection) => void
}) {
  const missing = paragraph.sourceBlockIds.length === 0

  if (missing) {
    // A broken traceability link is rendered loud, not opened.
    return (
      <p className='tf-paragraph tf-paragraph--missing'>
        {paragraph.text}
        <span className='chip chip-contested tf-missing-chip'>
          missing source reference
        </span>
      </p>
    )
  }

  return (
    <button
      type='button'
      className={`tf-paragraph tf-paragraph--clickable${lede ? ' tf-paragraph--lede' : ''}`}
      onClick={() =>
        onInspect({
          kind,
          transformedText: paragraph.text,
          sourceBlockIds: paragraph.sourceBlockIds,
          transformationType: paragraph.transformationType,
          fidelityRisk: paragraph.fidelityRisk,
        })
      }
    >
      {paragraph.text}
    </button>
  )
}
