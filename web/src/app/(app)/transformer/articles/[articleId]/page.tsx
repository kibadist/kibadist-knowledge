'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ArticleView } from '@/components/transformer/article-view'
import { CoveragePanel } from '@/components/transformer/coverage-panel'
import { IllustrationPanel } from '@/components/transformer/illustration-panel'
import { LearningToolsPanel } from '@/components/transformer/learning-tools-panel'
import {
  type InspectorSelection,
  SourceInspectorPanel,
} from '@/components/transformer/source-inspector-panel'
import {
  api,
  type FidelityFinding,
  type FidelityReport,
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
 * The rich article experience (DET-256/257/258/259). Polls every 1.5s while the
 * article is still generating, then renders the full source-preserving view:
 * header badges, in-progress / FAILED / BLOCKED / FINAL states, the editorial
 * article body with a clickable source inspector, the coverage panel, and the
 * (clearly separated, AI-assisted) learning + illustration panels.
 */
export default function ArticlePage() {
  const { articleId } = useParams<{ articleId: string }>()
  const [selection, setSelection] = useState<InspectorSelection | null>(null)

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
          <header className='tf-article-badges'>
            <span className='chip chip-info'>Source-preserving mode</span>
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
          </header>

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

          {/* BLOCKED: artifacts exist but the fidelity gate rejected them. The
              article still renders, under a prominent banner of WHY. */}
          {article.status === 'BLOCKED' && article.fidelityReport && (
            <BlockedBanner report={article.fidelityReport} />
          )}

          {/* The article body renders for FINAL and BLOCKED (with the banner). */}
          {article.articleJson &&
            (article.status === 'FINAL' || article.status === 'BLOCKED') && (
              <ArticleView
                article={article.articleJson}
                onInspect={setSelection}
              />
            )}

          {/* Coverage (DET-255). */}
          {article.coverageReport &&
            (article.status === 'FINAL' || article.status === 'BLOCKED') && (
              <CoveragePanel
                coverage={article.coverageReport}
                blocksById={blocksById}
              />
            )}

          {/* AI-assisted layers — only meaningful once an article body exists. */}
          {(article.status === 'FINAL' || article.status === 'BLOCKED') && (
            <div className='tf-ai-layers'>
              <LearningToolsPanel
                articleId={article.id}
                layer={article.learningLayer}
                onInspect={setSelection}
              />
              <IllustrationPanel
                articleId={article.id}
                plan={article.illustrationPlan}
                onInspect={setSelection}
              />
            </div>
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

// The blocked banner lists the high-severity findings explaining the rejection.
function BlockedBanner({ report }: { report: FidelityReport }) {
  const groups: { label: string; findings: FidelityFinding[] }[] = [
    { label: 'Added information', findings: report.addedInformation },
    { label: 'Lost information', findings: report.lostInformation },
    { label: 'Meaning changes', findings: report.meaningChanges },
    { label: 'Unsupported headings', findings: report.unsupportedHeadings },
    { label: 'Missing caveats', findings: report.missingCaveats },
    { label: 'Unsupported examples', findings: report.unsupportedExamples },
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

  return (
    <section className='panel tf-blocked-banner'>
      <div className='tf-blocked-head'>
        <span className='chip chip-contested'>Blocked by fidelity gate</span>
        <h3 className='panel-h'>This article was held back</h3>
      </div>
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
    </section>
  )
}
