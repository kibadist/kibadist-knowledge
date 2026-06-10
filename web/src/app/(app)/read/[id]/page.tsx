'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  type ArticleProvenance,
  DeepReadingMode,
  type ReadingMode,
  type SavedConcept,
  type ScheduledReviewPrompt,
  type StageKey,
} from '@/components/deep-reading'
import { MagazineArticle } from '@/components/magazine/magazine-article'
import { ArticleReader } from '@/components/reader/article-reader'
import { SourceInspector } from '@/components/transformer/source-inspector'
import {
  ApiError,
  api,
  type CaptureSource,
  type FrictionLevel,
  type TransformedArticleStatus,
} from '@/lib/api'
import {
  type ArticleLearningEvent,
  type ArticleLearningEventDraft,
  useArticleLearningState,
} from '@/lib/article-learning-events'
import type { ArticleV2 } from '@/lib/article-v2'
import type { AiAssistMode } from '@/lib/editorial-layout'
import {
  ARTICLE_STEPS,
  articleStatusLabel,
  articleStepIndex,
  isArticleTerminal,
} from '@/lib/transformer-format'
import { transformerArticleToV2 } from '@/lib/transformer-to-article-v2'

import '../../transformer/transformer.css'
import './read.css'

type ReadView = 'source' | 'article' | 'exercise' | 'inspector'

// The Read-stage modes (the Article tab); everything else is an Exercise mode.
// Used to route `?mode=` deep-links to the right tab and to scope each tab's
// surface to a coherent slice of the learning arc. The Article tab is a single
// unblurrable reading surface now — Deep Reading was folded into Overview (you
// reveal a section in place), so `overview` is the only Read-stage mode.
const READ_MODES: ReadonlySet<ReadingMode> = new Set(['overview'])

// How long a generating-poll waits after an error before trying again. Far
// slower than the success cadence so a 429 (or any blip) can't snowball into a
// request storm against the rate-limited API; the poll self-recovers.
const ERROR_BACKOFF_MS = 15000

// Cadence while the article is still generating. Deliberately unhurried (3s, not
// the old 1.5s): two queries poll in parallel, so a slow generation at 1.5s
// approached the 120/min per-user rate limit on its own — 3s halves that.
const GENERATING_POLL_MS = 3000

// Illustrations are planned + rendered in the BACKGROUND after the article is
// terminal (DET-319), so a freshly generated article has no plates yet. Keep a
// slow, BOUNDED poll going after FINAL/BLOCKED until the illustrationPlan
// lands, so the plates pop in without a manual reload. The window covers the
// worst-case plan + 3 gpt-image renders; a planning failure persists nothing,
// so the cap (not the plan's arrival) ends the poll in that case.
const ILLUSTRATION_POLL_MS = 5000
const ILLUSTRATION_POLL_WINDOW_MS = 180_000

// The three learning tabs, always present. The Inspector (the pipeline "behind
// the article" view, V1 Decision 3) is NOT a peer tab — it's a quiet secondary
// link beside the row, rendered below, that only turns loud on a fidelity block.
const READ_TABS: { view: ReadView; label: string }[] = [
  { view: 'source', label: 'Source' },
  { view: 'article', label: 'Article' },
  { view: 'exercise', label: 'Exercise' },
]

/**
 * The document workspace (DET-312). One canonical reading route that resolves an
 * inbox item → its companion source → the latest generated article, and wraps
 * three surfaces behind a single Source · Article · Exercise toggle:
 *
 *  - **Source** — the cleaned original (noise removed), reused verbatim via
 *    `ArticleReader`.
 *  - **Article** — the refined transformer output as a worked example to *read*:
 *    `<DeepReadingMode>` scoped to the Read stage (Overview + Deep reading), fed
 *    through `transformerArticleToV2` (the single adaptation boundary).
 *  - **Exercise** — the *active* learning surface over that same article:
 *    `<DeepReadingMode>` scoped to the Recall + Keep stages (predict / rewrite /
 *    compare, then extract concept candidates / spaced review). This is where
 *    reading turns into kept knowledge.
 *
 * Source is readable the instant the page opens; the Article/Exercise tabs show
 * the pipeline-progress state while the article is still generating and the page
 * defaults to Article once it reaches FINAL. A persistent provenance eyebrow sits
 * above the toggle so the student always knows what they're reading on every
 * view. `?view=source|article|exercise` and `?mode=` are carried in the URL so
 * deep-links (onboarding, DET-307) open straight into the right view + mode — a
 * recall/keep `?mode=` implies the Exercise tab, a read mode the Article tab.
 */
export default function ReadPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const params = useSearchParams()

  const viewParam = params.get('view')
  const explicitView: ReadView | null =
    viewParam === 'source' ||
    viewParam === 'article' ||
    viewParam === 'exercise' ||
    viewParam === 'inspector'
      ? viewParam
      : null
  const initialMode = readingModeFromParam(params.get('mode'))
  // A `?mode=` deep-link implies a tab: a read mode → Article, anything else
  // (predict/rewrite/compare/extract/review) → Exercise.
  const modeView: ReadView | null = initialMode
    ? READ_MODES.has(initialMode)
      ? 'article'
      : 'exercise'
    : null

  // Resolve the source by inbox item id (the companion sourceId + latest article
  // id ride along on the detail). Poll while the companion article is still
  // generating so the toggle and the auto-advance pick up FINAL without a reload.
  const itemQuery = useQuery({
    queryKey: ['inbox-item', id],
    queryFn: () => api.getInboxItem(id),
    refetchInterval: (query) => {
      // Back off hard on error (esp. a 429 rate-limit) so a transient failure
      // can't turn the generating-poll into a self-sustaining request storm —
      // it eases off, the rate window clears, and it resumes on its own.
      if (query.state.status === 'error') return ERROR_BACKOFF_MS
      const status = query.state.data?.latestArticleStatus
      return status && isArticleTerminal(status) ? false : GENERATING_POLL_MS
    },
  })
  const item = itemQuery.data
  const articleId = item?.latestArticleId ?? null
  const articleStatus = item?.latestArticleStatus ?? null
  // A FINAL article is the default read. A BLOCKED one is still readable (the
  // fidelity gate held it back, not the pipeline) but stays opt-in — the Source
  // is the safer default when fidelity flagged the reshape. FAILED has no body.
  const articleFinal = articleStatus === 'FINAL'
  // "Generating" only until the pipeline reaches a terminal state; once
  // FINAL/BLOCKED/FAILED the toggle stops claiming it's still on its way.
  const articleGenerating =
    articleStatus === null || !isArticleTerminal(articleStatus)

  // The toggle is the only thing that pins a view. Until the student picks one,
  // the view follows the deep-link (`?mode=` → Article or Exercise) and then
  // readiness: Source while generating (readable now), Article the moment it's
  // FINAL — the DET-312 auto-advance, achieved by derivation rather than an
  // effect that could fight the URL.
  const [pinnedView, setPinnedView] = useState<ReadView | null>(
    explicitView ?? modeView,
  )
  const effectiveView: ReadView =
    pinnedView ?? modeView ?? (articleFinal ? 'article' : 'source')

  const pickView = useCallback(
    (next: ReadView) => {
      setPinnedView(next)
      const sp = new URLSearchParams(Array.from(params.entries()))
      sp.set('view', next)
      // A plain tab switch drops any citation deep-link target (DET-318) so a
      // stale highlight doesn't replay the next time the Inspector opens.
      sp.delete('block')
      router.replace(`/read/${id}?${sp.toString()}`, { scroll: false })
    },
    [params, router, id],
  )

  // A citation's "Open in Source" (DET-318): jump to the Inspector with the
  // cited source block carried in `?block=`, where the block list highlights
  // and scrolls to it. The Inspector is the one surface that renders the same
  // pinned TransformerSourceBlock id space the citations live in.
  const openSourceBlock = useCallback(
    (blockId: string) => {
      setPinnedView('inspector')
      const sp = new URLSearchParams(Array.from(params.entries()))
      sp.set('view', 'inspector')
      sp.set('block', blockId)
      router.replace(`/read/${id}?${sp.toString()}`, { scroll: false })
    },
    [params, router, id],
  )
  const citedBlockId = params.get('block')

  return (
    <div className='screen read-screen'>
      <Link href='/inbox' className='back-link'>
        ← Back to Sources
      </Link>

      <div className='page-head'>
        <span className='section-label'>§ Read</span>
        <h1>{item?.title ?? 'Reading…'}</h1>
      </div>

      {itemQuery.isLoading && <p className='notice'>Loading…</p>}
      {itemQuery.isError && (
        <SourceUnavailable id={id} error={itemQuery.error} />
      )}

      {item && (
        <>
          <ProvenanceEyebrow
            captureSource={item.captureSource}
            sourceUrl={item.sourceUrl}
            capturedAt={item.createdAt}
          />

          <div className='read-toggle-row'>
            <div
              className='read-toggle'
              role='tablist'
              aria-label='Source, Article, or Exercise'
            >
              {READ_TABS.map((tab) => (
                <button
                  key={tab.view}
                  type='button'
                  role='tab'
                  aria-selected={effectiveView === tab.view}
                  className={`read-toggle-opt${effectiveView === tab.view ? ' is-on' : ''}`}
                  onClick={() => pickView(tab.view)}
                >
                  {tab.label}
                  {/* Article + Exercise both ride on the generated article. */}
                  {(tab.view === 'article' || tab.view === 'exercise') &&
                    articleGenerating && (
                      <span className='read-toggle-pending'>· generating</span>
                    )}
                </button>
              ))}
            </div>

            {/* The Inspector is a quiet secondary entry, not a peer tab (V1
                Decision 3) — it only gets loud when the fidelity gate held the
                article back, where inspecting the source is the obvious fix. */}
            {item.sourceId && (
              <button
                type='button'
                aria-pressed={effectiveView === 'inspector'}
                className={`read-inspect${effectiveView === 'inspector' ? ' is-on' : ''}${
                  articleStatus === 'BLOCKED' ? ' is-fidelity' : ''
                }`}
                onClick={() => pickView('inspector')}
              >
                {articleStatus === 'BLOCKED'
                  ? '⚠ Held back by fidelity — Inspect →'
                  : 'Inspect pipeline →'}
              </button>
            )}
          </div>

          {effectiveView === 'inspector' ? (
            // Inspector — the pipeline "behind the article" view (V1 Decision 3),
            // folded in from the former standalone /transformer/[sourceId] route.
            // The tab only appears when a source exists; the guard covers a stray
            // `?view=inspector` deep-link on an item with no companion source.
            item.sourceId ? (
              <SourceInspector
                sourceId={item.sourceId}
                embedded
                highlightBlockId={citedBlockId}
              />
            ) : (
              <p className='notice'>
                No source pipeline to inspect for this item.
              </p>
            )
          ) : effectiveView === 'source' ? (
            // Source view — the cleaned original, reused verbatim. Immediately
            // readable even while the Article is still being generated.
            <ArticleReader
              document={item.sourceDocument}
              content={item.sourceText}
              title={item.title}
              sourceUrl={item.sourceUrl}
              captureSource={item.captureSource}
              capturedAt={item.createdAt}
            />
          ) : articleId ? (
            // Article + Exercise are the same resolved article, scoped to a
            // different slice of the learning arc by `surface`. ArticleView stays
            // mounted across an Article⇄Exercise switch (same element position),
            // so learning progress carries over between the two tabs.
            <ArticleView
              articleId={articleId}
              inboxItemId={id}
              surface={effectiveView}
              initialMode={initialMode}
              onOpenSource={item.sourceId ? openSourceBlock : undefined}
              onInspect={
                item.sourceId ? () => pickView('inspector') : undefined
              }
            />
          ) : (
            // No article row exists yet — the companion pipeline hasn't started
            // one. itemQuery is polling; this resolves to ArticleView shortly.
            <ArticleProgress status={item.latestArticleStatus} />
          )}
        </>
      )}
    </div>
  )
}

/**
 * What to show when the inbox-item lookup fails. The server only serves items
 * still in the inbox (`status: INBOX`), so a 404 usually doesn't mean "gone" —
 * it means the source *graduated*: earning promotes the item in place (INBOX →
 * PERMANENT), so the same id now resolves as a concept. Rather than dead-end on
 * a generic error, we check and route the learner forward to where the knowledge
 * now lives. A non-404 (network/500) keeps the original transient message; a
 * 404 with no matching concept means it was genuinely discarded or isn't theirs.
 */
function SourceUnavailable({ id, error }: { id: string; error: unknown }) {
  const notFound = error instanceof ApiError && error.status === 404
  const rateLimited = error instanceof ApiError && error.status === 429

  const earnedQuery = useQuery({
    queryKey: ['concept', id],
    queryFn: () => api.getConcept(id),
    enabled: notFound,
    retry: false,
  })

  // Rate-limited — transient. The poll has already backed off and will recover
  // on its own, so say so rather than implying the source is broken.
  if (rateLimited) {
    return (
      <p className='notice'>
        Easing off — too many requests. Retrying shortly…
      </p>
    )
  }

  // Transient / server error — not a "this is gone" signal. Keep it honest.
  if (!notFound) {
    return <p className='notice notice-error'>Could not load this source.</p>
  }

  if (earnedQuery.isLoading) {
    return <p className='notice'>Checking where this went…</p>
  }

  // The source was earned — it lives in the concept library now. Send them on.
  if (earnedQuery.isSuccess) {
    return (
      <section className='panel panel-raised'>
        <div className='section-label'>§ Earned</div>
        <h2 className='panel-h'>You’ve already earned this source</h2>
        <p className='block-sub'>
          It’s left the reading queue and now lives in your concepts as{' '}
          <strong>{earnedQuery.data.title}</strong>.
        </p>
        <p>
          <Link href={`/concepts/${id}`} className='btn-primary'>
            View concept <span className='ar'>→</span>
          </Link>
        </p>
      </section>
    )
  }

  // Genuinely no longer reachable: discarded, or it belongs to another workspace.
  return (
    <section className='panel'>
      <p className='notice notice-error'>
        This source isn’t in your inbox anymore.
      </p>
      <p className='block-sub'>
        It may have been discarded, or it belongs to a different workspace.
      </p>
      <p>
        <Link href='/inbox' className='btn-ghost'>
          ← Back to Sources
        </Link>
      </p>
    </section>
  )
}

/**
 * The Article + Exercise views — the refined transformer output as the Deep
 * Reading surface, with the polling + provenance + learning-event wiring lifted
 * from the standalone article page (DET-301). It owns the data + gates (status,
 * progress hydration, the promotion gate) and hands the resolved article to a
 * `ReadingSurface` scoped to the requested `surface`:
 *  - `'article'` → the Read stage (Overview + Deep reading): read the worked example.
 *  - `'exercise'` → the Recall + Keep stages: predict / rewrite / compare, then
 *    extract concept candidates / spaced review.
 *
 * The transformer's "Behind the article" appendix stays on its own page — this
 * workspace is for reading and exercising, not inspecting the pipeline.
 */
function ArticleView({
  articleId,
  inboxItemId,
  surface,
  initialMode,
  onOpenSource,
  onInspect,
}: {
  articleId: string
  inboxItemId: string
  surface: 'article' | 'exercise'
  initialMode?: ReadingMode
  /** Citation deep-link (DET-318): open the Inspector at a cited source block. */
  onOpenSource?: (sourceBlockId: string) => void
  /** Folio fidelity escalation (DET-324): open the pipeline Inspector. */
  onInspect?: () => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const articleQuery = useQuery({
    queryKey: ['transformer-article', articleId],
    queryFn: () => api.getTransformedArticle(articleId),
    refetchInterval: (query) => {
      // Same error backoff as the item poll: don't hammer a rate-limited API.
      if (query.state.status === 'error') return ERROR_BACKOFF_MS
      const data = query.state.data
      const status = data?.status
      if (!status || !isArticleTerminal(status)) return GENERATING_POLL_MS
      // Terminal. FAILED never gets illustrations (the background job only
      // runs after FINAL/BLOCKED); an article already carrying its plan needs
      // nothing more. Otherwise keep a slow poll inside a bounded window so
      // the background-rendered plates appear without a manual reload —
      // anchored on the server's own updatedAt (the terminal persist), so a
      // STALE plan-less article (pre-illustration era, or a planning failure
      // that persists nothing) is never polled at all.
      if (status === 'FAILED' || data?.illustrationPlan) return false
      const sinceTerminal = Date.now() - new Date(data.updatedAt).getTime()
      return Number.isFinite(sinceTerminal) &&
        sinceTerminal >= 0 &&
        sinceTerminal < ILLUSTRATION_POLL_WINDOW_MS
        ? ILLUSTRATION_POLL_MS
        : false
    },
  })
  const article = articleQuery.data

  // Provenance for the modes (DET-278 §5): the source link, how it was captured,
  // and whether the original spans are still available behind it.
  const sourceQuery = useQuery({
    queryKey: ['transformer-source', article?.sourceId],
    queryFn: () => api.getTransformerSource(article?.sourceId ?? ''),
    enabled: Boolean(article?.sourceId),
  })
  const blocksQuery = useQuery({
    queryKey: ['transformer-article-blocks', articleId],
    queryFn: () => api.getTransformedArticleBlocks(articleId),
    enabled: Boolean(article?.sourceId),
  })

  // The single adaptation boundary (lib/transformer-to-article-v2): section and
  // block ids carry through so learning events anchor to the persisted ids.
  const learningArticle = useMemo(() => {
    if (!article?.articleJson) return null
    return transformerArticleToV2(article.articleJson, {
      articleId: article.id,
      sourceId: article.sourceId,
    })
  }, [article?.articleJson, article?.id, article?.sourceId])

  const provenance = useMemo<ArticleProvenance>(
    () => ({
      sourceUrl: sourceQuery.data?.url ?? null,
      captureSource: captureSourceForType(sourceQuery.data?.type),
      sourceAvailable: (blocksQuery.data?.length ?? 0) > 0,
    }),
    [sourceQuery.data?.url, sourceQuery.data?.type, blocksQuery.data],
  )

  // Hydrate prior activity so completion markers survive a reload. Gated on the
  // article being readable; the surface waits for this before mounting.
  const eventsQuery = useQuery({
    queryKey: ['article-learning-events', articleId],
    queryFn: () => api.listArticleLearningEvents(articleId),
    enabled: Boolean(
      article?.articleJson &&
        (article.status === 'FINAL' || article.status === 'BLOCKED'),
    ),
  })
  const eventsReady = eventsQuery.isSuccess || eventsQuery.isError

  // Persist every emitted event (fire-and-forget; the in-memory store already
  // reflects it). id/timestamps/user are server-owned, so we send only the
  // whitelisted draft fields.
  const persistEvent = useMutation({
    mutationFn: (draft: ArticleLearningEventDraft) =>
      api.createArticleLearningEvent(draft),
  })
  const emitEvent = useCallback(
    (event: ArticleLearningEvent) => persistEvent.mutate(toEventDraft(event)),
    [persistEvent],
  )

  // The single promotion gate (DET-315). Reading IS processing: approving a
  // concept in Extract mode WITH the learner's own-words explanation earns the
  // inbox item itself, reusing the existing promote service (DET-189) at MINIMAL
  // friction — the explanation is the Articulate gate. No separate Process pass.
  // The proof-of-learning invariant is preserved server-side: a verbatim or
  // AI-authored articulation is rejected by the compression gate at commit.
  const [earned, setEarned] = useState<{ id: string } | null>(null)
  const earnConcept = useMutation({
    mutationFn: async (explanation: string) => {
      // Initialise/load the promotion draft, force the articulate-only friction
      // level, save the learner's words, then commit it as a standalone concept.
      await api.getPromotion(inboxItemId)
      await api.setFriction(inboxItemId, 'MINIMAL' as FrictionLevel)
      await api.saveArticulation(inboxItemId, explanation)
      return api.commitPromotion(inboxItemId, { isRoot: true, connections: [] })
    },
    onSuccess: (concept) => {
      setEarned({ id: concept.id })
      // The item leaves the reading queue (badge + list). We intentionally do NOT
      // invalidate ['inbox-item', inboxItemId] — the article is terminal so this
      // page no longer polls, and refetching the now-earned (non-INBOX) item
      // would 404 the surface the learner is still on.
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
    },
  })

  // Fallback Concept Library write (DET-283): a candidate approved without an
  // own-words explanation (or after the item is already earned) becomes a fresh
  // INBOX "to learn" concept rather than promoting the source in place.
  const saveConcept = useMutation({
    mutationFn: (c: SavedConcept) =>
      api.createConcept({
        title: c.name,
        summary: c.definition ? c.definition.slice(0, 500) : undefined,
        sourceText:
          (c.user_explanation && c.user_explanation.trim()) ||
          c.definition ||
          undefined,
      }),
  })

  // Route an approved candidate: an explained, validated concept earns the item
  // (once); anything else is a library write. Guards against double-promotion.
  const handleSaveConcept = useCallback(
    (c: SavedConcept) => {
      const explanation = c.user_explanation?.trim()
      if (
        c.status === 'user_validated' &&
        explanation &&
        !earned &&
        !earnConcept.isPending
      ) {
        earnConcept.mutate(explanation)
      } else {
        saveConcept.mutate(c)
      }
    },
    [earned, earnConcept, saveConcept],
  )

  // Retrieval Engine sink (DET-301/DET-288): an approved Spaced Review prompt is
  // handed to the engine; idempotent server-side on the deterministic prompt_id.
  const schedulePrompt = useMutation({
    mutationFn: (p: ScheduledReviewPrompt) =>
      api.scheduleReviewPrompt(toReviewPromptDraft(p)),
  })

  // "Save as Concept" on a key-concept device (DET-319): the existing DET-283
  // validate flow — idempotent server-side (a `conceptId` on the candidate means
  // it was already promoted; re-validating never creates a second row).
  const validateCandidate = useMutation({
    mutationFn: (candidateId: string) =>
      api.setLearningItemValidation(articleId, candidateId, 'validated'),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      })
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
    },
  })

  // Strict vs Enhanced (DET-323): a render-time choice persisted per article.
  // The lanes are always generated and stored, so toggling is instant and
  // retroactive — strict simply renders zero ✦ AI-marked surfaces.
  const [aiMode, setAiMode] = useAiAssistMode(articleId)

  const showBody =
    article?.articleJson &&
    (article.status === 'FINAL' || article.status === 'BLOCKED')

  if (articleQuery.isLoading) return <p className='notice'>Loading article…</p>
  // A miss here is almost always transient: the companion article is still being
  // (re)generated, or the inbox poll handed us an id that a regeneration has just
  // replaced. The query keeps polling (refetchInterval ignores the error), so we
  // self-heal rather than dead-end — and the Source tab is always readable now.
  if (articleQuery.isError)
    return (
      <section className='panel panel-raised tf-progress'>
        <div className='tf-progress-label'>Catching up to the article…</div>
        <p className='block-sub'>
          It’s still settling — most likely finishing generation. Read the
          Source meanwhile; this view refreshes on its own.
        </p>
      </section>
    )
  if (!article) return null

  // Still generating / failed — never a dead wait; the Source view is one toggle
  // away and remains readable.
  if (!showBody) return <ArticleProgress status={article.status} />

  if (!learningArticle) return null

  if (!eventsReady) return <p className='notice'>Loading your progress…</p>

  return (
    <>
      {/* BLOCKED is readable but the fidelity gate flagged the reshape — say so,
          and point back at the Source as the trustworthy original (DET-281). */}
      {article.status === 'BLOCKED' && (
        <p className='notice notice-error'>
          Held back by the fidelity check — read it against the Source.
        </p>
      )}
      {/* The single promotion gate's result (DET-315): earning leaves the queue
          and lives in your concepts; a rejected articulation says why. */}
      {earned && (
        <p className='notice notice-ok'>
          Earned — it’s in your concepts.{' '}
          <Link href={`/concepts/${earned.id}`}>View concept →</Link>
        </p>
      )}
      {earnConcept.isError && (
        <p className='notice notice-error'>
          {earnConcept.error instanceof Error
            ? earnConcept.error.message
            : 'Could not earn this yet — explain it in your own words first.'}
        </p>
      )}
      {surface === 'article' ? (
        // The Article tab is the finished, readable Compendium render (DET-318) —
        // a magazine/encyclopedia presentation of the same Article JSON v2, with
        // any rendered illustrations placed as plates. The active-recall modes
        // stay on the Exercise tab.
        <>
          <div
            className='read-ai-mode'
            role='group'
            aria-label='AI assistance level'
          >
            <button
              type='button'
              aria-pressed={aiMode === 'strict'}
              className={aiMode === 'strict' ? 'is-on' : undefined}
              onClick={() => setAiMode('strict')}
            >
              Strict · source only
            </button>
            <button
              type='button'
              aria-pressed={aiMode === 'enhanced'}
              className={aiMode === 'enhanced' ? 'is-on' : undefined}
              onClick={() => setAiMode('enhanced')}
            >
              Enhanced · with AI aids
            </button>
          </div>
          <MagazineArticle
            article={learningArticle}
            articleId={articleId}
            illustrations={article.illustrationPlan?.suggestions ?? []}
            enrichment={article.enrichment}
            editorialLayout={article.editorialLayout}
            sourceBlocks={blocksQuery.data ?? []}
            onOpenSource={onOpenSource}
            terminology={article.terminology}
            conceptCandidates={article.learningLayer?.conceptCandidates ?? []}
            onValidateCandidate={(c) => validateCandidate.mutate(c.id)}
            retrievalPrompts={article.learningLayer?.retrievalPrompts ?? []}
            onPromptAttempt={(p) =>
              // An attempted inline prompt is a learning EVENT, never knowledge
              // (DET-321/315): log it through the same persisted event stream the
              // Exercise modes use; reading alone still earns nothing.
              persistEvent.mutate({
                article_id: learningArticle.article_id,
                article_version_id: learningArticle.article_version_id,
                source_span_ids: p.sourceBlockIds,
                event_type: 'retrieval_prompt_attempted',
                prompt: p.prompt,
                metadata: {
                  prompt_id: p.id,
                  prompt_type: p.promptType ?? null,
                  difficulty: p.difficulty ?? null,
                },
              })
            }
            aiAssistMode={aiMode}
            fidelity={{
              score: article.fidelityScore,
              blocked: article.status === 'BLOCKED',
            }}
            onInspectFidelity={onInspect}
            provenance={provenance}
          />
        </>
      ) : (
        <ReadingSurface
          surface={surface}
          article={learningArticle}
          provenance={provenance}
          initialMode={initialMode}
          initialEvents={eventsQuery.data ?? []}
          onEmit={emitEvent}
          onSaveConcept={handleSaveConcept}
          onSchedulePrompt={(p) => schedulePrompt.mutate(p)}
          recallAid={<InterrogationAid inboxItemId={inboxItemId} />}
        />
      )}
    </>
  )
}

// The two stage-scopes that back the Article and Exercise tabs. Article reads the
// worked example (Read stage); Exercise runs active recall and earns/schedules
// what's worth keeping (Recall + Keep stages — concept candidates included).
const SURFACE_STAGES: Record<'article' | 'exercise', StageKey[]> = {
  article: ['read'],
  exercise: ['recall', 'keep'],
}
const SURFACE_EYEBROW: Record<'article' | 'exercise', string> = {
  article: 'Generated article · worked example',
  exercise: 'Active recall · earn what you keep',
}
const SURFACE_DEFAULT_MODE: Record<'article' | 'exercise', ReadingMode> = {
  article: 'overview',
  exercise: 'predict',
}

/**
 * Renders the Deep Reading surface for one tab. It holds the shared learning-event
 * store so progress + persisted events carry across an Article⇄Exercise switch
 * (this component stays mounted; only the inner `<DeepReadingMode key={surface}>`
 * remounts to pick up the new stage scope + opening mode). `initialMode` from a
 * `?mode=` deep-link is honoured when it belongs to this surface, else the tab's
 * natural default opens (DeepReadingMode also clamps defensively).
 */
function ReadingSurface({
  surface,
  article,
  provenance,
  initialMode,
  initialEvents,
  onEmit,
  onSaveConcept,
  onSchedulePrompt,
  recallAid,
}: {
  surface: 'article' | 'exercise'
  article: ArticleV2
  provenance: ArticleProvenance
  initialMode?: ReadingMode
  initialEvents: ArticleLearningEvent[]
  onEmit: (event: ArticleLearningEvent) => void
  onSaveConcept: (concept: SavedConcept) => void
  onSchedulePrompt: (prompt: ScheduledReviewPrompt) => void
  recallAid: React.ReactNode
}) {
  // Shared store, seeded once from the hydrated events. Lives above the keyed
  // DeepReadingMode so a tab switch doesn't drop in-session progress.
  const learning = useArticleLearningState({ onEmit, initialEvents })
  // A read mode belongs to the Article tab, any other mode to the Exercise tab.
  const belongsHere = initialMode
    ? READ_MODES.has(initialMode) === (surface === 'article')
    : false
  const openMode = belongsHere ? initialMode : SURFACE_DEFAULT_MODE[surface]
  return (
    <DeepReadingMode
      key={surface}
      article={article}
      provenance={provenance}
      stages={SURFACE_STAGES[surface]}
      eyebrow={SURFACE_EYEBROW[surface]}
      initialMode={openMode}
      learningState={learning}
      onSaveConcept={onSaveConcept}
      onSchedulePrompt={onSchedulePrompt}
      recallAid={recallAid}
    />
  )
}

/**
 * The demoted interrogation Q&A (DET-315) — once a mandatory Process pass, now an
 * OPTIONAL comprehension scaffold inside the Recall stage. The AI asks questions
 * to make you think; nothing here is saved as knowledge (earning happens in
 * Extract concepts). The LLM call is deferred until the learner opens the aid.
 */
function InterrogationAid({ inboxItemId }: { inboxItemId: string }) {
  const [open, setOpen] = useState(false)
  const questionsQuery = useQuery({
    queryKey: ['interrogation', inboxItemId],
    queryFn: () => api.generateInterrogation(inboxItemId),
    enabled: open,
  })
  return (
    <details
      className='kb-dr-recall-aid-panel'
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Comprehension scaffold · questions to make you think</summary>
      <p className='block-sub'>
        Optional. These prompts test your grasp before you reconstruct the
        material — answer them in your head. They’re a reading aid, never saved
        as knowledge; you earn a concept by explaining it in Extract concepts.
      </p>
      {questionsQuery.isLoading && (
        <p className='notice'>Thinking up questions…</p>
      )}
      {questionsQuery.isError && (
        <p className='notice notice-error'>
          Could not load questions right now.
        </p>
      )}
      {questionsQuery.data && questionsQuery.data.length > 0 && (
        <ol className='kb-dr-recall-aid-list'>
          {questionsQuery.data.map((q) => (
            <li key={q.id}>{q.prompt}</li>
          ))}
        </ol>
      )}
    </details>
  )
}

/**
 * Per-article Strict/Enhanced choice (DET-323), persisted in localStorage so it
 * survives reloads without a server round-trip. Initialized to 'enhanced' and
 * hydrated in an effect (never in the initializer) so SSR markup matches.
 */
function useAiAssistMode(
  articleId: string,
): [AiAssistMode, (mode: AiAssistMode) => void] {
  const key = `kb_ai_assist_mode:${articleId}`
  const [mode, setMode] = useState<AiAssistMode>('enhanced')
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored === 'strict' || stored === 'enhanced') setMode(stored)
    } catch {
      // Private mode / storage denied — the session default stands.
    }
  }, [key])
  const update = useCallback(
    (next: AiAssistMode) => {
      setMode(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Best-effort persistence only.
      }
    },
    [key],
  )
  return [mode, update]
}

/**
 * The pipeline-progress state, reused from the article page's in-progress ribbon
 * (DET-256). FAILED gets an honest message; everything else shows the step track.
 */
function ArticleProgress({
  status,
}: {
  status: TransformedArticleStatus | null
}) {
  if (status === 'FAILED') {
    return (
      <section className='panel tf-error-panel'>
        <h3 className='panel-h'>Generation failed</h3>
        <p className='tf-error-text'>
          The article could not be produced. The Source view above is still
          fully readable.
        </p>
      </section>
    )
  }
  return (
    <section className='panel panel-raised tf-progress'>
      <div className='tf-progress-label'>
        {status ? `${articleStatusLabel(status)}…` : 'Preparing the article…'}
      </div>
      <div className='tf-progress-track'>
        {ARTICLE_STEPS.map((step, i) => (
          <span
            key={step}
            className={`tf-progress-seg${
              status && i <= articleStepIndex(status) ? ' is-on' : ''
            }`}
          />
        ))}
      </div>
      <p className='block-sub'>
        Modeling the source, planning the reshape, generating, then checking
        every sentence against the source. Read the Source meanwhile — it’s
        ready now.
      </p>
    </section>
  )
}

/** Persistent provenance eyebrow — capture source · host · date, shown above the
 *  toggle on both views so the student always knows the origin of what they read. */
function ProvenanceEyebrow({
  captureSource,
  sourceUrl,
  capturedAt,
}: {
  captureSource: CaptureSource | null
  sourceUrl: string | null
  capturedAt: string
}) {
  const label = captureSource ? CAPTURE_SOURCE_LABEL[captureSource] : null
  const host = hostOf(sourceUrl)
  const date = new Date(capturedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const parts: React.ReactNode[] = []
  if (label) parts.push(<span key='label'>{label}</span>)
  if (host)
    parts.push(
      <a
        key='host'
        href={sourceUrl ?? undefined}
        target='_blank'
        rel='noopener noreferrer'
      >
        {host}
      </a>,
    )
  parts.push(<span key='date'>{date}</span>)

  return (
    <p className='read-prov'>
      <span className='read-prov-dot' aria-hidden='true' />
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && (
            <span className='read-prov-sep' aria-hidden='true'>
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </p>
  )
}

const CAPTURE_SOURCE_LABEL: Record<CaptureSource, string> = {
  PASTE: 'Pasted text',
  URL: 'Web link',
  PDF: 'PDF',
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Map a `?mode=` query value to a reading mode (DET-307 deep-links), ignoring
// anything unrecognized so a stray param just opens the default deep view.
const READING_MODES: ReadonlySet<ReadingMode> = new Set([
  'deep',
  'overview',
  'predict',
  'rewrite',
  'compare',
  'extract',
  'review',
])
function readingModeFromParam(value: string | null): ReadingMode | undefined {
  return value && READING_MODES.has(value as ReadingMode)
    ? (value as ReadingMode)
    : undefined
}

// The capture-source label the modes show (DET-278 §5). The transformer source
// `type` is the capture method; map it to the shared CaptureSource vocabulary.
function captureSourceForType(
  type: 'TEXT' | 'URL' | 'PDF' | undefined,
): CaptureSource | null {
  switch (type) {
    case 'TEXT':
      return 'PASTE'
    case 'URL':
      return 'URL'
    case 'PDF':
      return 'PDF'
    default:
      return null
  }
}

// Strip server-owned fields before persisting (id/timestamps are stamped on
// write; user comes from the JWT). The API whitelist rejects extras.
function toEventDraft(event: ArticleLearningEvent): ArticleLearningEventDraft {
  return {
    article_id: event.article_id,
    article_version_id: event.article_version_id,
    section_id: event.section_id,
    block_id: event.block_id,
    source_span_ids: event.source_span_ids,
    event_type: event.event_type,
    prompt: event.prompt,
    user_answer: event.user_answer,
    ai_feedback: event.ai_feedback,
    metadata: event.metadata,
  }
}

// Map an approved Spaced Review prompt to the Retrieval Engine draft (DET-301).
// id/schedule/timestamps are server-owned; schedule_metadata and section_heading
// are client-only display state and not persisted.
function toReviewPromptDraft(p: ScheduledReviewPrompt) {
  return {
    prompt_id: p.prompt_id,
    article_id: p.article_id,
    article_version_id: p.article_version_id,
    section_id: p.section_id,
    concept_id: p.concept_id,
    prompt_type: p.prompt_type,
    origin: p.origin,
    subject: p.subject,
    question: p.question,
    expected_answer_summary: p.expected_answer_summary,
    source_span_ids: p.source_span_ids,
    created_from_event_id: p.created_from_event_id,
  }
}
