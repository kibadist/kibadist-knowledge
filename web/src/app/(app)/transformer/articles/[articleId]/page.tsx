'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ArticleView } from '@/components/transformer/article-view'
import { CoveragePanel } from '@/components/transformer/coverage-panel'
import { IllustrationPanel } from '@/components/transformer/illustration-panel'
import { placeIllustrations } from '@/components/transformer/illustration-placement'
import { LearningToolsPanel } from '@/components/transformer/learning-tools-panel'
import {
  type InspectorSelection,
  SourceInspectorPanel,
} from '@/components/transformer/source-inspector-panel'
import {
  type ArticleJsonV2,
  type ArticleSectionV2,
  type ArticleShape,
  api,
  type FidelityFinding,
  type FidelityReport,
  type SectionRole,
  type TransformerBlockView,
} from '@/lib/api'
import {
  ARTICLE_STEPS,
  articleStatusChip,
  articleStatusLabel,
  articleStepIndex,
  isArticleTerminal,
  severityChip,
} from '@/lib/transformer-format'

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
  const [selection, setSelection] = useState<InspectorSelection | null>(null)
  const queryClient = useQueryClient()

  // Per-section concept-extraction (DET-283). The mutation appends AI-assisted
  // candidates to the article's learning layer; on success we invalidate the
  // article query so the learning panel re-renders with the new candidates.
  const extractConcepts = useMutation({
    mutationFn: (sectionId: string) =>
      api.extractSectionConcepts(articleId, sectionId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['transformer-article', articleId],
      }),
  })

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

  // Distinct source blocks the article actually cites — drives the hero byline.
  // Coverage's totalBlocks (the whole source) is the better number when present;
  // fall back to counting distinct sourceBlockIds across the article body.
  const sourceBlockCount = useMemo(() => {
    if (article?.coverageReport) return article.coverageReport.totalBlocks
    if (!article?.articleJson) return null
    return countSourceBlocks(article.articleJson)
  }, [article?.coverageReport, article?.articleJson])

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

          {/* The article body renders for FINAL and BLOCKED. */}
          {showBody && article.articleJson && (
            <ArticleView
              article={article.articleJson}
              articleId={article.id}
              illustrationPlan={article.illustrationPlan}
              sourceBlockCount={sourceBlockCount}
              masthead={
                <>
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
                </>
              }
              onInspect={setSelection}
              onExtractConcepts={(sectionId) =>
                extractConcepts.mutate(sectionId)
              }
              extractingSectionId={
                extractConcepts.isPending
                  ? (extractConcepts.variables ?? null)
                  : null
              }
            />
          )}

          {/* "Behind the article": the appendix drawer — coverage, original
              structure, learning tools, and the illustration management grid. */}
          {showBody && (
            <details className='tf-behind'>
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

// Distinct source blocks cited anywhere in the article body — a byline signal
// when coverage isn't available.
function countSourceBlocks(article: ArticleJsonV2): number {
  const ids = new Set<string>()
  const add = (arr: string[]) => {
    for (const id of arr) ids.add(id)
  }
  const addSection = (s: ArticleSectionV2) => {
    add(s.sourceBlockIds)
    for (const b of s.blocks) add(b.sourceBlockIds)
    for (const sub of s.subsections ?? []) addSection(sub)
  }
  if (article.subtitle) add(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) add(p.sourceBlockIds)
  for (const s of article.sections) addSection(s)
  for (const t of article.keyTerms) add(t.sourceBlockIds)
  for (const e of article.sourceExamples) add(e.sourceBlockIds)
  for (const c of article.caveats) add(c.sourceBlockIds)
  return ids.size
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
