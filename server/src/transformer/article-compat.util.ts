import {
  ARTICLE_SCHEMA_VERSION,
  type ArticleJsonV2,
  type ArticleParagraphBlock,
  type ArticleSectionV2,
  type HeadingSource,
  type HeadingSourceV2,
  type SourcePreservingArticle,
} from './transformer.types'

/**
 * Article v1 ⇄ v2 compatibility adapter (DET-277).
 *
 * The server is the single read-time adaptation boundary: stored v1 JSON is
 * NEVER rewritten; `getArticle` runs `toArticleV2` so the web only ever sees v2.
 * Coverage / fidelity utilities adapt v1 first, then operate on v2 natively.
 *
 * Both helpers are PURE and idempotent — `toArticleV2` of an already-v2 value
 * returns it unchanged, discriminated on `schemaVersion`. The adapter changes
 * REPRESENTATION only (paragraph → paragraph block, heading-source renaming,
 * version stamp); it never adds or drops article substance.
 */

/** Map v1 heading provenance onto the v2 naming. */
function toHeadingSourceV2(source: HeadingSource): HeadingSourceV2 {
  switch (source) {
    case 'original':
      return 'original'
    case 'light_reword':
      return 'cleanedOriginal'
    case 'inferred_from_source':
      return 'inferred'
  }
}

/** True if the value is already a v2 article (discriminated on schemaVersion). */
export function isArticleV2(
  json: SourcePreservingArticle | ArticleJsonV2,
): json is ArticleJsonV2 {
  return (
    (json as Partial<ArticleJsonV2>).schemaVersion === ARTICLE_SCHEMA_VERSION
  )
}

/**
 * Adapt a v1 `SourcePreservingArticle` to `ArticleJsonV2`. Idempotent: a value
 * already carrying `schemaVersion: 'v2'` is returned unchanged.
 *
 * v1 paragraphs become v2 paragraph blocks preserving id / sourceBlockIds /
 * transformationType / fidelityRisk; heading provenance is renamed; the version
 * is stamped. `abstract`, `keyTerms`, `sourceExamples`, `caveats` and
 * `originalStructure` carry over verbatim.
 */
export function toArticleV2(
  json: SourcePreservingArticle | ArticleJsonV2,
): ArticleJsonV2 {
  if (isArticleV2(json)) return json
  const v1 = json

  const sections: ArticleSectionV2[] = v1.sections.map((s) => ({
    id: s.id,
    heading: s.heading,
    headingSource: toHeadingSourceV2(s.headingSource),
    sourceBlockIds: s.sourceBlockIds,
    blocks: s.paragraphs.map(
      (p): ArticleParagraphBlock => ({
        id: p.id,
        type: 'paragraph',
        text: p.text,
        sourceBlockIds: p.sourceBlockIds,
        transformationType: p.transformationType,
        fidelityRisk: p.fidelityRisk,
      }),
    ),
  }))

  return {
    schemaVersion: ARTICLE_SCHEMA_VERSION,
    mode: v1.mode,
    title: { text: v1.title.text, source: toHeadingSourceV2(v1.title.source) },
    subtitle: v1.subtitle
      ? {
          text: v1.subtitle.text,
          source: toHeadingSourceV2(v1.subtitle.source),
          sourceBlockIds: v1.subtitle.sourceBlockIds,
        }
      : undefined,
    abstract: v1.abstract,
    sections,
    keyTerms: v1.keyTerms,
    sourceExamples: v1.sourceExamples,
    caveats: v1.caveats,
    originalStructure: v1.originalStructure,
  }
}
