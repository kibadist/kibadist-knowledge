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

/**
 * Collect EVERY source block id cited anywhere in an article — across all v2
 * block types, nested subsections, subtitle, keyTerms, sourceExamples, caveats,
 * readingAids highlights — adapting v1 first so the walk is uniform.
 *
 * This is the read-only traceability primitive shared by the golden-fixture
 * suite (DET-279): pass the result against the source block id set to find any
 * fragment that references a block the source does not contain. Production
 * guards (`assertKnownIds`, `mergeDeterministicChecks`) keep their own focused
 * walks; this one is a complete inventory used to AUDIT a finished article.
 */
export function collectArticleSourceBlockIds(
  input: SourcePreservingArticle | ArticleJsonV2,
): string[] {
  const article = toArticleV2(input)
  const ids: string[] = []
  const add = (xs: string[]) => {
    for (const x of xs) ids.push(x)
  }

  if (article.subtitle) add(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) add(p.sourceBlockIds)

  const walkSection = (s: ArticleSectionV2) => {
    add(s.sourceBlockIds)
    if (s.headingSourceBlockIds) add(s.headingSourceBlockIds)
    for (const b of s.blocks) add(b.sourceBlockIds)
    for (const sub of s.subsections ?? []) walkSection(sub)
  }
  for (const s of article.sections) walkSection(s)

  for (const t of article.keyTerms) add(t.sourceBlockIds)
  for (const e of article.sourceExamples) add(e.sourceBlockIds)
  for (const c of article.caveats) add(c.sourceBlockIds)

  for (const h of article.readingAids?.highlights ?? []) add(h.sourceBlockIds)

  return ids
}

/**
 * Read-only traceability audit (DET-279): the cited block ids that DO NOT exist
 * in the supplied source block id set. Empty ⇒ every fragment is traceable.
 * Used by the golden-fixture suite to assert source-inspector mapping is intact
 * for all block types, and to flag an unsupported readingAids highlight.
 */
export function findUnknownSourceBlockIds(
  input: SourcePreservingArticle | ArticleJsonV2,
  known: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>()
  for (const id of collectArticleSourceBlockIds(input))
    if (!known.has(id)) unknown.add(id)
  return [...unknown]
}
