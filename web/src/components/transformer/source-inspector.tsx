'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PipelineStatus } from '@/components/transformer/pipeline-status'
import {
  ApiError,
  api,
  type TransformerBlockView,
  type TransformerSourceMetadata,
} from '@/lib/api'
import {
  articleStatusChip,
  articleStatusLabel,
  blockClassChip,
  blockClassLabel,
  blockLocationLine,
  isSourceTerminal,
  sourceStatusChip,
  sourceStatusLabel,
  sourceTypeLabel,
} from '@/lib/transformer-format'

/**
 * Source Inspector (DET-247…250, folded into the document workspace per V1 spec
 * Decision 3). The "behind the article" view — pipeline status, the transform /
 * re-run control, the prominent extraction error, and a collapsed block-level
 * fidelity panel — extracted from the old standalone `/transformer/[sourceId]`
 * page so it can mount as the Inspector tab inside `/read/[id]` *and* back the
 * legacy route. It owns only its own queries; the surrounding screen frame and
 * any back navigation belong to the host page.
 *
 * The ordered step indicator polls every 1.5s while the pipeline is non-terminal;
 * the blocks inspector exposes the debug detail (type, classification, removable
 * + reason, uncertain, location) but stays demoted into a collapsed panel
 * (DET-303) so a non-technical reader sees status and errors first.
 */
export function SourceInspector({
  sourceId,
  embedded = false,
}: {
  sourceId: string
  /**
   * Mounted inside the /read workspace, which already renders the item title.
   * Suppresses this view's own `<h1>` so the page has a single heading; the
   * section-label + status chips stay for context. Standalone (orphan-source
   * fallback) keeps the full header.
   */
  embedded?: boolean
}) {
  const queryClient = useQueryClient()

  const sourceQuery = useQuery({
    queryKey: ['transformer-source', sourceId],
    queryFn: () => api.getTransformerSource(sourceId),
    // Poll while the pipeline runs; stop the moment it settles. Back off hard on
    // error (esp. a 429 rate-limit) so the poll can't snowball into a storm.
    refetchInterval: (query) => {
      if (query.state.status === 'error') return 15000
      const status = query.state.data?.status
      return status && isSourceTerminal(status) ? false : 1500
    },
  })

  const source = sourceQuery.data
  const isReady = source?.status === 'READY'

  const blocksQuery = useQuery({
    queryKey: ['transformer-source-blocks', sourceId, source?.blocksVersion],
    queryFn: () => api.getTransformerSourceBlocks(sourceId),
    enabled: Boolean(source) && (source?.blocksVersion ?? 0) > 0,
  })

  const transform = useMutation({
    mutationFn: () => api.transformSource(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['transformer-source', sourceId],
      })
    },
  })

  // Force the v3 Source-Grounded Learning engine (DET-343), independent of the
  // global flag. Invalidate the inbox-item query too so the host /read page picks
  // up the new article id and resumes polling (it stops once an article is
  // terminal), surfacing the v3 learning layer in the Article tab.
  const transformV3 = useMutation({
    mutationFn: () => api.transformSourceV3(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['transformer-source', sourceId],
      })
      queryClient.invalidateQueries({ queryKey: ['inbox-item'] })
    },
  })

  const metadata = (source?.metadata ??
    null) as TransformerSourceMetadata | null
  const truncated = metadata?.truncated === true
  const degraded = metadata?.degraded === true

  // The in-flight guard returns 409; surface it politely rather than as a raw error.
  const transformConflict =
    transform.error instanceof ApiError && transform.error.status === 409
  const transformError =
    transform.isError && !transformConflict
      ? transform.error instanceof ApiError
        ? transform.error.message
        : 'Could not start the transform.'
      : null

  if (sourceQuery.isLoading) return <p className='notice'>Loading source…</p>
  if (sourceQuery.isError)
    return <p className='notice notice-error'>Could not load this source.</p>
  if (!source) return null

  return (
    <>
      <div className='page-head'>
        <div className='section-label'>
          § Inspector · {sourceTypeLabel(source.type)}
        </div>
        {!embedded && (
          <h1>{source.title ?? source.url ?? source.fileName ?? 'Source'}</h1>
        )}
        <div className='tf-detail-meta'>
          <span className={`chip ${sourceStatusChip(source.status)}`}>
            {sourceStatusLabel(source.status)}
          </span>
          {truncated && (
            <span className='chip chip-pending'>source truncated</span>
          )}
          {degraded && (
            <span className='chip chip-pending'>degraded extraction</span>
          )}
        </div>
      </div>

      <section className='panel panel-raised'>
        <PipelineStatus status={source.status} />
      </section>

      {source.extractionError && (
        <section className='panel tf-error-panel'>
          <h3 className='panel-h'>Extraction failed</h3>
          <p className='tf-error-text'>{source.extractionError}</p>
        </section>
      )}

      {/* Article card: latest article status + transform / re-run action. */}
      <section className='panel tf-article-card'>
        <div className='tf-article-card-head'>
          <h3 className='panel-h'>Article</h3>
          {source.latestArticleStatus && (
            <span
              className={`chip ${articleStatusChip(source.latestArticleStatus)}`}
            >
              {articleStatusLabel(source.latestArticleStatus)}
            </span>
          )}
        </div>

        {source.latestArticleId ? (
          <p className='block-sub'>
            An article has been generated for this source.
          </p>
        ) : (
          <p className='block-sub'>
            {isReady
              ? 'The source is ready. Generate a source-preserving article.'
              : 'The article becomes available once the pipeline reaches Ready.'}
          </p>
        )}

        {transformConflict && (
          <p className='notice'>
            A transform is already running for this source. It’ll appear here
            when it finishes.
          </p>
        )}
        {transformError && (
          <p className='notice notice-error'>{transformError}</p>
        )}

        {transformV3.isError && (
          <p className='notice notice-error'>
            {transformV3.error instanceof ApiError
              ? transformV3.error.message
              : 'Could not start the v3 learning article.'}
          </p>
        )}

        <div className='tf-article-card-actions'>
          <button
            type='button'
            className='btn-ghost'
            disabled={!isReady || transform.isPending || transformV3.isPending}
            onClick={() => transform.mutate()}
          >
            {transform.isPending
              ? 'Starting…'
              : source.latestArticleId
                ? 'Re-run transform'
                : 'Transform'}
          </button>
          {/* v3 Source-Grounded Learning engine (DET-343) — observable without
              flipping a feature flag. */}
          <button
            type='button'
            className='btn-primary'
            disabled={!isReady || transform.isPending || transformV3.isPending}
            onClick={() => transformV3.mutate()}
          >
            {transformV3.isPending
              ? 'Generating…'
              : 'Generate v3 learning article'}
          </button>
        </div>
      </section>

      {/* Source fidelity details (DET-250 inspector, demoted by DET-303).
          Block-level debug detail — type, classification, removable + reason,
          and the blocks version — is appendix material for a non-technical
          reader, so it lives in a collapsed panel that's hidden by default.
          Status and the extraction-error panel above stay prominent. */}
      <details className='panel tf-blocks tf-fidelity'>
        <summary className='tf-fidelity-summary'>
          <span className='tf-fidelity-kicker'>Source fidelity details</span>
          {source.blocksVersion > 0 && (
            <span className='mono-label'>
              {source.blockCount} blocks · v{source.blocksVersion}
            </span>
          )}
          <span className='tf-fidelity-caret' aria-hidden='true'>
            ▾
          </span>
        </summary>
        <div className='tf-fidelity-body'>
          {blocksQuery.isLoading && <p className='notice'>Loading blocks…</p>}
          {(source.blocksVersion ?? 0) === 0 && !blocksQuery.isLoading && (
            <p className='block-sub'>
              Blocks appear once the source is segmented.
            </p>
          )}
          {blocksQuery.data && blocksQuery.data.length > 0 && (
            <ol className='tf-block-list'>
              {blocksQuery.data.map((b) => (
                <BlockRow key={b.id} block={b} />
              ))}
            </ol>
          )}
        </div>
      </details>
    </>
  )
}

function BlockRow({ block }: { block: TransformerBlockView }) {
  const loc = blockLocationLine(block)
  return (
    <li className='tf-block'>
      <div className='tf-block-meta'>
        <span className='tf-block-index'>{block.orderIndex}</span>
        <span className='mono-label'>{block.blockType}</span>
        {block.classification && (
          <span className={`chip ${blockClassChip(block.classification)}`}>
            {blockClassLabel(block.classification)}
          </span>
        )}
        {block.classification === 'UNCERTAIN' && (
          <span className='chip chip-pending'>uncertain</span>
        )}
        {block.removable && (
          <span className='chip chip-contested'>removable</span>
        )}
        {loc && <span className='tf-block-loc'>{loc}</span>}
      </div>
      <p className='tf-block-text'>{block.text}</p>
      {block.removable && block.noiseReason && (
        <p className='tf-block-reason'>Removed: {block.noiseReason}</p>
      )}
    </li>
  )
}
