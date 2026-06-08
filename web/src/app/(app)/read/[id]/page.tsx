'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import {
  type ArticleProvenance,
  DeepReadingMode,
  type ReadingMode,
  type SavedConcept,
  type ScheduledReviewPrompt,
  type StageKey,
} from '@/components/deep-reading'
import { ArticleReader } from '@/components/reader/article-reader'
import {
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
import {
  ARTICLE_STEPS,
  articleStatusLabel,
  articleStepIndex,
  isArticleTerminal,
} from '@/lib/transformer-format'
import { transformerArticleToV2 } from '@/lib/transformer-to-article-v2'

import '../../transformer/transformer.css'
import './read.css'

type ReadView = 'source' | 'article' | 'exercise'

// The Read-stage modes (the Article tab); everything else is an Exercise mode.
// Used to route `?mode=` deep-links to the right tab and to scope each tab's
// surface to a coherent slice of the learning arc.
const READ_MODES: ReadonlySet<ReadingMode> = new Set(['overview', 'deep'])

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
    viewParam === 'exercise'
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
      const status = query.state.data?.latestArticleStatus
      return status && isArticleTerminal(status) ? false : 1500
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
      router.replace(`/read/${id}?${sp.toString()}`, { scroll: false })
    },
    [params, router, id],
  )

  return (
    <div className='screen read-screen'>
      <Link href='/inbox' className='back-link'>
        ← Back to Read
      </Link>

      <div className='page-head'>
        <span className='section-label'>§ Read</span>
        <h1>{item?.title ?? 'Reading…'}</h1>
      </div>

      {itemQuery.isLoading && <p className='notice'>Loading…</p>}
      {itemQuery.isError && (
        <p className='notice notice-error'>Could not load this source.</p>
      )}

      {item && (
        <>
          <ProvenanceEyebrow
            captureSource={item.captureSource}
            sourceUrl={item.sourceUrl}
            capturedAt={item.createdAt}
          />

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
                {tab.view !== 'source' && articleGenerating && (
                  <span className='read-toggle-pending'>· generating</span>
                )}
              </button>
            ))}
          </div>

          {effectiveView === 'source' ? (
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
}: {
  articleId: string
  inboxItemId: string
  surface: 'article' | 'exercise'
  initialMode?: ReadingMode
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const articleQuery = useQuery({
    queryKey: ['transformer-article', articleId],
    queryFn: () => api.getTransformedArticle(articleId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isArticleTerminal(status) ? false : 1500
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
  article: 'deep',
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
