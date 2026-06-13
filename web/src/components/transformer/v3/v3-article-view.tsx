import type {
  ArticleBlockV3,
  ArticleJsonV3,
  ArticleSectionV3,
  Provenance,
  QualityReport,
} from '@/lib/article-v3'
import { isScaffold } from '@/lib/article-v3'

import { V3LearningPanel } from './v3-learning-panel'

/**
 * The v3 reader surface (DET-343) — the missing wiring between the
 * Source-Grounded Learning Article that the v3 pipeline writes (`articleJsonV3`)
 * and the document workspace's Read page.
 *
 * The v2 read path renders `article.articleJson` through `MagazineArticle`; a v3
 * row never writes that column (it only writes `articleJsonV3` + `qualityReport`),
 * so without this component a v3 article is structurally unrenderable — the Read
 * page falls through to an empty "Preparing the article…" state forever. This is
 * the component the Read page mounts when `pipelineVersion === 'v3'`.
 *
 * It renders BOTH halves of the v3 deliverable:
 *  - the source-grounded article BODY (sections → blocks), where every block and
 *    the title/summary carry a `provenance` so AI scaffolding is VISIBLY DISTINCT
 *    from source-grounded content (the "✦ AI · not from your source" marker, the
 *    same contract the Compendium enrichment lane already uses); and
 *  - the LEARNING LAYER + quality verdict via `V3LearningPanel` (learning path,
 *    key concepts/claims, retrieval prompts, source notes, provenance %).
 *
 * `surface` scopes which half leads: the Article tab reads the body (panel as an
 * aside); the Exercise tab leads with the learning layer (retrieval prompts /
 * concepts to work) over a collapsed body.
 */
export function V3ArticleView({
  article,
  quality,
  surface,
}: {
  article: ArticleJsonV3
  quality: QualityReport | null
  surface: 'article' | 'exercise'
}) {
  if (surface === 'exercise') {
    return (
      <div className='tf-v3'>
        <V3LearningPanel article={article} quality={quality} />
        <details className='tf-v3-bodyfold'>
          <summary>Read the full article again</summary>
          <V3ArticleBody article={article} />
        </details>
      </div>
    )
  }
  return (
    <div className='tf-v3'>
      <V3ArticleBody article={article} />
      <V3LearningPanel article={article} quality={quality} />
    </div>
  )
}

/**
 * The source-grounded article body. A learning-first document: the shape (lesson,
 * concept explainer, …) drives the prose, but every block declares whether it is a
 * faithful rewrite of named source blocks (`source`) or AI connective tissue
 * (`scaffold`). Scaffold content is marked so the student always knows what came
 * from their source and what the engine added.
 */
export function V3ArticleBody({ article }: { article: ArticleJsonV3 }) {
  return (
    <article className='tf-v3-body'>
      <header className='tf-v3-body-head'>
        <h2 className='tf-v3-title'>
          {article.title.text}
          <ProvenanceMark provenance={article.title.provenance} />
        </h2>
        <p className='tf-v3-summary'>
          {article.summary.text}
          <ProvenanceMark provenance={article.summary.provenance} />
        </p>
      </header>

      {article.sections.map((section) => (
        <V3Section key={section.id} section={section} />
      ))}
    </article>
  )
}

function V3Section({ section }: { section: ArticleSectionV3 }) {
  return (
    <section className='tf-v3-body-section'>
      <h3 className='tf-v3-body-h'>
        {section.heading}
        <ProvenanceMark provenance={section.headingProvenance} />
      </h3>
      {section.blocks.map((block) => (
        <V3BodyBlock key={block.id} block={block} />
      ))}
    </section>
  )
}

/** One article block, rendered by type, tagged source-grounded vs AI scaffold. */
function V3BodyBlock({ block }: { block: ArticleBlockV3 }) {
  const scaffold = isScaffold(block.provenance)
  // The provenance class is the visible contract: scaffold blocks get a dashed,
  // indigo-tinted frame (AI connective tissue); source blocks read as plain prose.
  const cls = `tf-v3-block tf-v3-block-${block.type}${
    scaffold ? ' is-scaffold' : ' is-source'
  }`

  const body = (() => {
    if (block.type === 'list' && block.items && block.items.length > 0) {
      return (
        <ul className='tf-v3-block-list'>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    }
    return <p className='tf-v3-block-text'>{block.text}</p>
  })()

  return (
    <div className={cls} data-provenance={block.provenance}>
      {block.type === 'definition' && (
        <span className='tf-v3-block-tag'>Definition</span>
      )}
      {block.type === 'example' && (
        <span className='tf-v3-block-tag'>Example</span>
      )}
      {body}
      {scaffold ? (
        <span className='tf-v3-aimark'>✦ AI · not from your source</span>
      ) : (
        <span className='tf-v3-srcmark'>From your source</span>
      )}
    </div>
  )
}

/** The inline provenance marker for headings/title/summary. */
function ProvenanceMark({ provenance }: { provenance: Provenance }) {
  if (!isScaffold(provenance)) return null
  return <span className='tf-v3-aimark tf-v3-aimark-inline'>✦ AI</span>
}
