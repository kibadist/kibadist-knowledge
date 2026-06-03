'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
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

import '../transformer.css'

/**
 * Source pipeline view (DET-247…250). The ordered step indicator polls every 1.5s
 * while the pipeline is non-terminal, the extraction error surfaces prominently,
 * the blocks inspector exposes the debug detail (type, classification, removable +
 * reason, uncertain, location), and the article card surfaces the latest article
 * and a Transform / Re-run action that politely handles the 409 in-flight guard.
 */
export default function SourceDetailPage() {
  const { sourceId } = useParams<{ sourceId: string }>()
  const queryClient = useQueryClient()

  const sourceQuery = useQuery({
    queryKey: ['transformer-source', sourceId],
    queryFn: () => api.getTransformerSource(sourceId),
    // Poll while the pipeline runs; stop the moment it settles.
    refetchInterval: (query) => {
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

  return (
    <div className='screen'>
      <Link href='/transformer' className='back-link'>
        ← All sources
      </Link>

      {sourceQuery.isLoading && <p className='notice'>Loading source…</p>}
      {sourceQuery.isError && (
        <p className='notice notice-error'>Could not load this source.</p>
      )}

      {source && (
        <>
          <div className='page-head'>
            <div className='section-label'>
              § Transformer · {sourceTypeLabel(source.type)}
            </div>
            <h1>{source.title ?? source.url ?? source.fileName ?? 'Source'}</h1>
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
              {source.blocksVersion > 0 && (
                <span className='mono-label'>
                  {source.blockCount} blocks · v{source.blocksVersion}
                </span>
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
                A transform is already running for this source. It’ll appear
                here when it finishes.
              </p>
            )}
            {transformError && (
              <p className='notice notice-error'>{transformError}</p>
            )}

            <div className='tf-article-card-actions'>
              {source.latestArticleId && (
                <Link
                  href={`/transformer/articles/${source.latestArticleId}`}
                  className='btn-primary'
                >
                  Open article <span className='ar'>→</span>
                </Link>
              )}
              <button
                type='button'
                className='btn-ghost'
                disabled={!isReady || transform.isPending}
                onClick={() => transform.mutate()}
              >
                {transform.isPending
                  ? 'Starting…'
                  : source.latestArticleId
                    ? 'Re-run transform'
                    : 'Transform'}
              </button>
            </div>
          </section>

          {/* Blocks inspector (DET-250). */}
          <section className='panel tf-blocks'>
            <h3 className='panel-h'>Blocks</h3>
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
          </section>
        </>
      )}
    </div>
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
