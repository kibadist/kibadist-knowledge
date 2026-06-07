'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
  type ArticleProvenance,
  DeepReadingMode,
  type ReadingMode,
  type SavedConcept,
  type ScheduledReviewPrompt,
} from '@/components/deep-reading'
import { CoveragePanel } from '@/components/transformer/coverage-panel'
import { IllustrationPanel } from '@/components/transformer/illustration-panel'
import { placeIllustrations } from '@/components/transformer/illustration-placement'
import { LearningToolsPanel } from '@/components/transformer/learning-tools-panel'
import { ReorderAuditPanel } from '@/components/transformer/reorder-audit-panel'
import {
  type InspectorSelection,
  SourceInspectorPanel,
} from '@/components/transformer/source-inspector-panel'
import {
  type ArticleJsonV2,
  type ArticleShape,
  api,
  type CaptureSource,
  type FidelityFinding,
  type FidelityReport,
  type SectionRole,
  type TransformerBlockView,
} from '@/lib/api'
import type {
  ArticleLearningEvent,
  ArticleLearningEventDraft,
} from '@/lib/article-learning-events'
import {
  ARTICLE_STEPS,
  articleStatusChip,
  articleStatusLabel,
  articleStepIndex,
  isArticleTerminal,
  severityChip,
} from '@/lib/transformer-format'
import { transformerArticleToV2 } from '@/lib/transformer-to-article-v2'

import '../../transformer.css'

/**
 * The rich article experience (DET-256/257/258/259), rebuilt as a
 * science-magazine page. Polls every 1.5s while the article is still
 * generating, then renders: an in-progress / FAILED state, a slim fidelity
 * ribbon for BLOCKED, the editorial article body (masthead + hero + inline
 * illustration slots + the clickable source inspector), and a collapsible
 * "Behind the article" appendix drawer holding coverage, learning tools, and
 * the illustration management grid.
 */
export default function ArticlePage() {
  const { articleId } = useParams<{ articleId: string }>()
  // Deep-link entry (DET-307): the onboarding checklist routes each step here with
  // `?mode=` so the reader opens straight into the relevant learning mode.
  const searchParams = useSearchParams()
  const initialMode = readingModeFromParam(searchParams.get('mode'))
  const [selection, setSelection] = useState<InspectorSelection | null>(null)

  // The "Behind the article" appendix drawer (coverage, structure, learning
  // tools, illustrations) stays controlled so it remains usable around the new
  // Deep Reading surface (DET-301).
  const [behindOpen, setBehindOpen] = useState(false)

  const articleQuery = useQuery({
    queryKey: ['transformer-article', articleId],
    queryFn: () => api.getTransformedArticle(articleId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isArticleTerminal(status) ? false : 1500
    },
  })

  const article = articleQuery.data

  // Resolve blocks for the inspector (DET-257) + coverage previews at the
  // article's PINNED blocksVersion — never the source's current version, which
  // a later re-extraction may bump (that would orphan every reference here).
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

  const blocksById = useMemo(() => {
    const map = new Map<string, TransformerBlockView>()
    for (const b of blocksQuery.data ?? []) map.set(b.id, b)
    return map
  }, [blocksQuery.data])

  const sourceUrl = sourceQuery.data?.url ?? null

  // DET-301: the reading surface is now Deep Reading Mode over the SAME v2
  // article, adapted from the transformer's magazine shape into the learning
  // contract. One adaptation boundary (lib/transformer-to-article-v2); section
  // and block ids carry through so learning events anchor to the persisted ids.
  const learningArticle = useMemo(() => {
    if (!article?.articleJson) return null
    return transformerArticleToV2(article.articleJson, {
      articleId: article.id,
      sourceId: article.sourceId,
    })
  }, [article?.articleJson, article?.id, article?.sourceId])

  // Provenance carried into the modes (DET-278 §5): the source link, how it was
  // captured, and whether the original spans are still available behind it.
  const provenance = useMemo<ArticleProvenance>(
    () => ({
      sourceUrl,
      captureSource: captureSourceForType(sourceQuery.data?.type),
      sourceAvailable: (blocksQuery.data?.length ?? 0) > 0,
    }),
    [sourceUrl, sourceQuery.data?.type, blocksQuery.data],
  )

  // Hydrate the learner's prior activity so completion markers survive a reload
  // (DET-301 acceptance). Gated on the article being readable; the surface waits
  // for this to settle before mounting so the store seeds with the full history.
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
  // whitelisted draft fields — the API rejects extras.
  const persistEvent = useMutation({
    mutationFn: (draft: ArticleLearningEventDraft) =>
      api.createArticleLearningEvent(draft),
  })
  const emitEvent = useCallback(
    (event: ArticleLearningEvent) => {
      persistEvent.mutate(toEventDraft(event))
    },
    [persistEvent],
  )

  // Concept Library sink (DET-283/301): an approved candidate becomes a real
  // INBOX "to learn" concept — the gate (DET-189) owns promotion from there. The
  // approval is also recorded in the event log; the two stores are distinct.
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

  // Retrieval Engine sink (DET-301/DET-288): an approved Spaced Review prompt is
  // handed to the engine — the real downstream store, distinct from the event log
  // (which records the approval action). The engine owns the schedule; idempotent
  // server-side on the deterministic prompt_id, so a re-approval updates in place.
  const schedulePrompt = useMutation({
    mutationFn: (p: ScheduledReviewPrompt) =>
      api.scheduleReviewPrompt(toReviewPromptDraft(p)),
  })

  // Suggestions not anchored inline → the drawer's management grid, so nothing
  // renders twice. Computed against the same placement the article view uses.
  const unplacedSuggestions = useMemo(() => {
    if (!article?.articleJson)
      return article?.illustrationPlan?.suggestions ?? []
    return placeIllustrations(article.articleJson, article.illustrationPlan)
      .unplaced
  }, [article?.articleJson, article?.illustrationPlan])

  const showBody =
    article?.articleJson &&
    (article.status === 'FINAL' || article.status === 'BLOCKED')

  return (
    <div className='screen tf-article-screen'>
      <Link
        href={article ? `/transformer/${article.sourceId}` : '/transformer'}
        className='back-link'
      >
        ← Back to source
      </Link>

      {articleQuery.isLoading && <p className='notice'>Loading article…</p>}
      {articleQuery.isError && (
        <p className='notice notice-error'>Could not load this article.</p>
      )}

      {article && (
        <>
          {/* In-progress: elegant step progress. */}
          {!isArticleTerminal(article.status) && (
            <section className='panel panel-raised tf-progress'>
              <div className='tf-progress-label'>
                {articleStatusLabel(article.status)}…
              </div>
              <div className='tf-progress-track'>
                {ARTICLE_STEPS.map((step, i) => (
                  <span
                    key={step}
                    className={`tf-progress-seg${
                      i <= articleStepIndex(article.status) ? ' is-on' : ''
                    }`}
                  />
                ))}
              </div>
              <p className='block-sub'>
                Modeling the source, planning the reshape, generating, then
                checking every sentence against the source.
              </p>
            </section>
          )}

          {/* FAILED: the pipeline could not produce schema-valid artifacts. */}
          {article.status === 'FAILED' && (
            <section className='panel tf-error-panel'>
              <h3 className='panel-h'>Generation failed</h3>
              <p className='tf-error-text'>
                {article.error ??
                  'The article could not be produced. Re-run the transform from the source.'}
              </p>
            </section>
          )}

          {/* BLOCKED: a slim ribbon that expands to today's full findings. The
              article still renders below — the story leads, not the apparatus. */}
          {article.status === 'BLOCKED' && article.fidelityReport && (
            <BlockedRibbon report={article.fidelityReport} />
          )}

          {/* The reading surface renders for FINAL and BLOCKED. DET-301 swaps the
              passive ArticleView for Deep Reading Mode over the same v2 article,
              so the learner gets the overview / predict / rewrite / compare /
              extract / review modes on their own material. The masthead chips
              are kept here (the demoted status/fidelity rule), and the BLOCKED
              ribbon above + the "Behind the article" drawer below stay in place. */}
          {showBody && learningArticle && (
            <>
              <div className='tf-masthead'>
                <span className='tf-masthead-kicker'>
                  Source-preserving transform
                </span>
                <div className='tf-masthead-chips'>
                  <span className='chip chip-info'>Source-preserving</span>
                  <span className={`chip ${articleStatusChip(article.status)}`}>
                    {articleStatusLabel(article.status)}
                  </span>
                  {article.fidelityReport && (
                    <span
                      className={`chip ${
                        article.fidelityReport.fidelityScore >= 95
                          ? 'chip-cleared'
                          : 'chip-pending'
                      }`}
                    >
                      Fidelity {article.fidelityReport.fidelityScore}
                    </span>
                  )}
                </div>
              </div>

              {eventsReady ? (
                <DeepReadingMode
                  article={learningArticle}
                  provenance={provenance}
                  initialMode={initialMode}
                  initialEvents={eventsQuery.data ?? []}
                  onEmit={emitEvent}
                  onSaveConcept={(c) => saveConcept.mutate(c)}
                  onSchedulePrompt={(p) => schedulePrompt.mutate(p)}
                />
              ) : (
                <p className='notice'>Loading your progress…</p>
              )}
            </>
          )}

          {/* "Behind the article": the appendix drawer — coverage, original
              structure, learning tools, and the illustration management grid. */}
          {showBody && (
            <details
              className='tf-behind'
              open={behindOpen}
              onToggle={(e) => setBehindOpen(e.currentTarget.open)}
            >
              <summary className='tf-behind-summary'>
                <span className='tf-behind-kicker'>Behind the article</span>
                <span className='tf-behind-hint'>
                  Source coverage · structure · learning tools · illustrations
                </span>
                <span className='tf-behind-caret' aria-hidden='true'>
                  ▾
                </span>
              </summary>

              <div className='tf-behind-body'>
                {article.articleJson?.shape && (
                  <ArticleShapePanel article={article.articleJson} />
                )}

                {article.articleJson && (
                  <ReorderAuditPanel
                    reorderings={article.articleJson.reorderings}
                    blocksById={blocksById}
                  />
                )}

                {article.coverageReport && (
                  <CoveragePanel
                    coverage={article.coverageReport}
                    blocksById={blocksById}
                  />
                )}

                {article.articleJson &&
                  article.articleJson.originalStructure.length > 0 && (
                    <OriginalStructure article={article.articleJson} />
                  )}

                <LearningToolsPanel
                  articleId={article.id}
                  layer={article.learningLayer}
                  sections={article.articleJson?.sections}
                  onInspect={setSelection}
                />

                <IllustrationPanel
                  articleId={article.id}
                  plan={article.illustrationPlan}
                  suggestions={unplacedSuggestions}
                  onInspect={setSelection}
                />
              </div>
            </details>
          )}
        </>
      )}

      <SourceInspectorPanel
        selection={selection}
        blocksById={blocksById}
        sourceUrl={sourceUrl}
        onClose={() => setSelection(null)}
      />
    </div>
  )
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

// Strip the server-owned fields before persisting (id/timestamps are stamped on
// write; user comes from the JWT). The API whitelist rejects extras, so we send
// exactly the draft contract.
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
// are client-only display state and not persisted. The API whitelist rejects
// extras, so we send exactly the contract fields.
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

// Editorial label for each genre shape + section role (DET-273), mirrored from
// the article-view maps so the drawer reads consistently with the body labels.
const SHAPE_LABEL: Record<ArticleShape, string> = {
  explainer: 'Explainer — concept first',
  argument: 'Argument — claim, evidence, caveats',
  procedure: 'Procedure — ordered steps preserved',
  reference: 'Reference — term-led entries',
  report: 'Report — source order',
  narrative: 'Narrative — chronological',
  hybrid: 'Hybrid — mixed structure',
}
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

// "Article shape" provenance (DET-273): the detected genre shape + the
// source-grounded role of each section. Surfaced in the drawer so the reader can
// see how the source was reorganized (form only — never new substance).
function ArticleShapePanel({ article }: { article: ArticleJsonV2 }) {
  if (!article.shape) return null
  const roled = article.sections.filter((s) => s.sectionRole != null)
  return (
    <section className='panel tf-shape-panel'>
      <h3 className='panel-h'>Article shape</h3>
      <p className='tf-shape-summary'>{SHAPE_LABEL[article.shape]}</p>
      {roled.length > 0 && (
        <ul className='tf-shape-roles'>
          {roled.map((s) => (
            <li key={s.id}>
              <span className='tf-shape-role-kind'>
                {s.sectionRole ? SECTION_ROLE_LABEL[s.sectionRole] : ''}
              </span>
              <span className='tf-shape-role-heading'>{s.heading}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// The original-structure outline, relocated out of the article body into the
// drawer (it's a reference appendix, not source-preserved reading matter).
function OriginalStructure({ article }: { article: ArticleJsonV2 }) {
  return (
    <section className='panel tf-original-structure'>
      <h3 className='panel-h'>Original structure reference</h3>
      <ol className='tf-outline'>
        {article.originalStructure.map((o) => (
          <li key={o.blockId}>
            <span className='tf-outline-type'>{o.blockType}</span>
            <span className='tf-outline-preview'>{o.preview}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// The blocked findings, grouped + collapsed behind a slim one-line ribbon.
function BlockedRibbon({ report }: { report: FidelityReport }) {
  const groups: { label: string; findings: FidelityFinding[] }[] = [
    { label: 'Added information', findings: report.addedInformation },
    { label: 'Lost information', findings: report.lostInformation },
    { label: 'Meaning changes', findings: report.meaningChanges },
    { label: 'Unsupported headings', findings: report.unsupportedHeadings },
    { label: 'Missing caveats', findings: report.missingCaveats },
    { label: 'Unsupported examples', findings: report.unsupportedExamples },
    // DET-281 — tolerate old stored reports that predate these two groups.
    { label: 'Emphasis changes', findings: report.emphasisChanges ?? [] },
    { label: 'Structural findings', findings: report.structuralFindings ?? [] },
  ]
  // Lead with the high-severity findings — they are why the gate blocked it.
  const blocking = groups
    .map((g) => ({
      label: g.label,
      findings: g.findings.filter((f) => f.severity === 'high'),
    }))
    .filter((g) => g.findings.length > 0)
  // Fall back to all findings if nothing is flagged high (score-threshold block).
  const shown =
    blocking.length > 0 ? blocking : groups.filter((g) => g.findings.length > 0)
  const issueCount = shown.reduce((n, g) => n + g.findings.length, 0)

  return (
    <details className='tf-ribbon'>
      <summary className='tf-ribbon-summary'>
        <span className='tf-ribbon-mark' aria-hidden='true'>
          ⚠
        </span>
        <span className='tf-ribbon-line'>
          Held back · fidelity {report.fidelityScore} · {issueCount} issue
          {issueCount === 1 ? '' : 's'}
        </span>
        <span className='tf-ribbon-cta'>review</span>
        <span className='tf-ribbon-caret' aria-hidden='true'>
          ▾
        </span>
      </summary>
      <div className='tf-ribbon-body'>
        <p className='block-sub'>
          The article is shown below, but the fidelity check found issues that
          must be reviewed. Fidelity score {report.fidelityScore}.
        </p>
        <div className='tf-blocked-findings'>
          {shown.map((g) => (
            <div key={g.label} className='tf-finding-group'>
              <h4 className='tf-aux-h'>{g.label}</h4>
              <ul className='tf-finding-list'>
                {g.findings.map((f, i) => (
                  <li key={`${g.label}-${i}`} className='tf-finding'>
                    <span className={`chip ${severityChip(f.severity)}`}>
                      {f.severity}
                    </span>
                    <span className='tf-finding-text'>{f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
