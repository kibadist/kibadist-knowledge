'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import {
  ApiError,
  type ArticleParagraph,
  api,
  type IllustrationPlan,
  type IllustrationSuggestion,
  type SourcePreservingArticle,
} from '@/lib/api'
import { fidelityRiskChip } from '@/lib/transformer-format'
import { placeIllustrations } from './illustration-placement'
import {
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
export function ArticleView({
  article,
  articleId,
  illustrationPlan,
  sourceBlockCount,
  masthead,
  onInspect,
}: {
  article: SourcePreservingArticle
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

  // One source-grounded pull-quote, pulled from the first caveat (real source
  // text), dropped roughly mid-article between sections. It only renders when
  // the caveat carries source block ids — an ungrounded quote would violate the
  // source-preservation promise.
  const pullCaveat = article.caveats.find((c) => c.sourceBlockIds.length > 0)
  const pullAt =
    article.sections.length > 1 ? Math.floor(article.sections.length / 2) : -1

  return (
    <article className='tf-article'>
      {/* ---- Masthead rule: kicker left, demoted chips right ---- */}
      <div className='tf-masthead'>
        <span className='tf-masthead-kicker'>Source-preserving transform</span>
        <div className='tf-masthead-chips'>{masthead}</div>
      </div>

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

      {article.sections.map((section, i) => {
        const slot = placement.bySection.get(section.id)
        return (
          <div key={section.id}>
            {i > 0 && <SectionOrnament />}
            <section className='tf-article-section'>
              <h2 className='tf-article-heading'>{section.heading}</h2>
              {slot && (
                <IllustrationSlot
                  articleId={articleId}
                  suggestion={slot}
                  approve={approve}
                  onInspect={onInspect}
                  variant='column'
                />
              )}
              {section.paragraphs.map((p) => (
                <Paragraph
                  key={p.id}
                  paragraph={p}
                  kind='Paragraph'
                  onInspect={onInspect}
                />
              ))}
            </section>
            {i === pullAt && pullCaveat && (
              <PullQuote
                text={pullCaveat.text}
                sourceBlockIds={pullCaveat.sourceBlockIds}
                onInspect={onInspect}
              />
            )}
          </div>
        )
      })}

      {article.keyTerms.length > 0 && (
        <section className='tf-article-aux'>
          <h3 className='tf-aux-h'>Key terms</h3>
          <dl className='tf-terms'>
            {article.keyTerms.map((t) => (
              <div key={t.term} className='tf-term'>
                <dt>
                  <button
                    type='button'
                    className='tf-term-btn'
                    onClick={() =>
                      onInspect({
                        kind: 'Key term',
                        transformedText: t.term,
                        sourceBlockIds: t.sourceBlockIds,
                      })
                    }
                  >
                    {t.term}
                  </button>
                  {t.sourceBlockIds.length === 0 && (
                    <span className='chip chip-contested'>missing source</span>
                  )}
                </dt>
              </div>
            ))}
          </dl>
        </section>
      )}

      {article.sourceExamples.length > 0 && (
        <section className='tf-article-aux'>
          <h3 className='tf-aux-h'>Source examples</h3>
          <ul className='tf-aux-list'>
            {article.sourceExamples.map((ex, i) => (
              <li key={`${i}-${ex.text.slice(0, 24)}`}>
                <button
                  type='button'
                  className='tf-aux-item'
                  onClick={() =>
                    onInspect({
                      kind: 'Source example',
                      transformedText: ex.text,
                      sourceBlockIds: ex.sourceBlockIds,
                    })
                  }
                >
                  {ex.text}
                </button>
                {ex.sourceBlockIds.length === 0 && (
                  <span className='chip chip-contested'>missing source</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {article.caveats.length > 0 && (
        <section className='tf-article-aux'>
          <h3 className='tf-aux-h'>Important caveats</h3>
          <ul className='tf-aux-list tf-caveats'>
            {article.caveats.map((c, i) => (
              <li key={`${i}-${c.text.slice(0, 24)}`}>
                <button
                  type='button'
                  className='tf-aux-item'
                  onClick={() =>
                    onInspect({
                      kind: 'Caveat',
                      transformedText: c.text,
                      sourceBlockIds: c.sourceBlockIds,
                    })
                  }
                >
                  {c.text}
                </button>
                {c.sourceBlockIds.length === 0 && (
                  <span className='chip chip-contested'>missing source</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

function SectionOrnament() {
  return (
    <div className='tf-ornament' aria-hidden='true'>
      <span className='tf-ornament-mark'>✶</span>
    </div>
  )
}

function PullQuote({
  text,
  sourceBlockIds,
  onInspect,
}: {
  text: string
  sourceBlockIds: string[]
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
              kind: 'Caveat',
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
  // a rendered figure can never read as source matter.
  const aiCaption = (
    <figcaption className='tf-fig-caption'>
      <span className='tf-fig-aichip'>✦ AI illustration</span>
      <span className='tf-fig-grounded'>
        AI · grounded in {s.sourceBlockIds.length} source block
        {s.sourceBlockIds.length === 1 ? '' : 's'}
      </span>
      {s.caption && <span className='tf-fig-text'>“{s.caption}”</span>}
    </figcaption>
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

function Paragraph({
  paragraph,
  kind,
  lede = false,
  onInspect,
}: {
  paragraph: ArticleParagraph
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
