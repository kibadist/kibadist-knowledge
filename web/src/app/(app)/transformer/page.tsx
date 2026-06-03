'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { CaptureCard } from '@/components/transformer/capture-card'
import { api, type TransformerSourceListItem } from '@/lib/api'
import {
  articleStatusChip,
  articleStatusLabel,
  readableDate,
  sourceStatusChip,
  sourceStatusLabel,
  sourceTypeLabel,
  sourceTypeMark,
} from '@/lib/transformer-format'

import './transformer.css'

/**
 * Transformer index (DET-256). The capture card (paste text / URL / PDF) plus the
 * workspace's source list: each row shows its type, title/url/filename, pipeline
 * status, and — once generated — its latest article status, linking into the
 * source's pipeline view.
 */
export default function TransformerPage() {
  const sourcesQuery = useQuery({
    queryKey: ['transformer-sources'],
    queryFn: api.listTransformerSources,
  })

  const sources = sourcesQuery.data ?? []

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Transformer · Source-preserving</div>
        <h1>Transformer</h1>
        <p className='lede'>
          Reshape a source into a magazine-quality article — without inventing,
          dropping, or bending what it says. Every sentence stays traceable to
          the source.
        </p>
      </div>

      <CaptureCard />

      {sourcesQuery.isLoading && <p className='notice'>Loading sources…</p>}
      {sourcesQuery.isError && (
        <p className='notice notice-error'>Could not load your sources.</p>
      )}

      {!sourcesQuery.isLoading && sources.length === 0 && (
        <div className='empty'>
          No sources yet.
          <span>Paste text, a link, or a PDF above to begin.</span>
        </div>
      )}

      {sources.length > 0 && (
        <ul className='rows tf-source-rows'>
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SourceRow({ source }: { source: TransformerSourceListItem }) {
  const label =
    source.title ?? source.url ?? source.fileName ?? 'Untitled source'

  return (
    <li className='tf-source-row'>
      <div className='row-top'>
        <span className='tf-type-mark' aria-hidden='true'>
          {sourceTypeMark(source.type)}
        </span>
        <span className='mono-label'>{sourceTypeLabel(source.type)}</span>
        <span className={`chip ${sourceStatusChip(source.status)}`}>
          {sourceStatusLabel(source.status)}
        </span>
        {source.latestArticleStatus && (
          <span
            className={`chip ${articleStatusChip(source.latestArticleStatus)}`}
          >
            Article · {articleStatusLabel(source.latestArticleStatus)}
          </span>
        )}
        <time className='tf-row-when'>{readableDate(source.createdAt)}</time>
      </div>

      <Link href={`/transformer/${source.id}`} className='row-title'>
        {label}
      </Link>

      {source.url && (
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          className='row-url'
        >
          {source.url}
        </a>
      )}

      <div className='row-foot'>
        <Link href={`/transformer/${source.id}`} className='row-process'>
          Open pipeline <span className='ar'>→</span>
        </Link>
        {source.latestArticleId && (
          <Link
            href={`/transformer/articles/${source.latestArticleId}`}
            className='row-process'
          >
            View article <span className='ar'>→</span>
          </Link>
        )}
      </div>
    </li>
  )
}
