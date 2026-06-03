'use client'

import type { ArticleParagraph, SourcePreservingArticle } from '@/lib/api'

import type { InspectorSelection } from './source-inspector-panel'

/**
 * The rich article body — the product's centerpiece (DET-256). Magazine-level
 * editorial rendering of a SourcePreservingArticle in fixed template order:
 * title, subtitle, abstract (with a refined lede / drop-cap treatment), sections,
 * then key terms, source examples, caveats, and a compact original-structure
 * outline. There is NO textarea and NO raw JSON anywhere — this is reading.
 *
 * Every paragraph is clickable → opens the source inspector (DET-257). A
 * paragraph with no source block ids renders an explicit error chip instead of
 * being openable, so a broken traceability link is loud, not hidden.
 */
export function ArticleView({
  article,
  onInspect,
}: {
  article: SourcePreservingArticle
  // Open the source inspector for a transformed fragment.
  onInspect: (selection: InspectorSelection) => void
}) {
  return (
    <article className='tf-article'>
      <header className='tf-article-head'>
        <h1 className='tf-article-title'>{article.title.text}</h1>
        {article.subtitle && (
          <p className='tf-article-subtitle'>{article.subtitle.text}</p>
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

      {article.sections.map((section) => (
        <section key={section.id} className='tf-article-section'>
          <h2 className='tf-article-heading'>{section.heading}</h2>
          {section.paragraphs.map((p) => (
            <Paragraph
              key={p.id}
              paragraph={p}
              kind='Paragraph'
              onInspect={onInspect}
            />
          ))}
        </section>
      ))}

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

      {article.originalStructure.length > 0 && (
        <section className='tf-article-aux tf-original-structure'>
          <h3 className='tf-aux-h'>Original structure reference</h3>
          <ol className='tf-outline'>
            {article.originalStructure.map((o) => (
              <li key={o.blockId}>
                <span className='tf-outline-type'>{o.blockType}</span>
                <span className='tf-outline-preview'>{o.preview}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
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
